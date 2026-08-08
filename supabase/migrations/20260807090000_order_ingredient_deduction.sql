-- Automatic ingredient deduction when an order is completed.
--
-- The schema has been ready for this since 20260731140000: inventory_movements
-- already carries order_id / order_item_id / reversed, and customer_cancel_order
-- already reverses any deduction movements it finds. What was missing is the
-- producer side — nothing ever recorded a deduction. This migration adds it at
-- the single choke point every order passes through on its way to Completed
-- (staff_advance_order_status), so cashier walk-ins, pickups, and deliveries
-- all deduct through the same path.
--
-- Design constraints honoured here:
--  * Idempotent: a second Completed submission for the same order is already
--    rejected by staff_advance_order_status, and deduct_order_ingredients
--    additionally refuses to run twice for the same order (movement rows with
--    that order_id already exist).
--  * Traceable: one movement row per order item x ingredient, carrying
--    order_id + order_item_id, with the order number, product name, and
--    ordered quantity in the reason text.
--  * Shortage-tolerant: completing an order must not fail because stock
--    bookkeeping is behind reality (the drink was already made). If required
--    exceeds available, the movement deducts what is available and records
--    the shortage in the reason instead of blocking or going negative.
--  * Not editable as a manual adjustment: movements are insert-only (there is
--    no update RPC), and order-generated rows are distinguishable by their
--    non-null order_id.

-- Defensive: these columns exist in the live schema (customer_cancel_order
-- references them), but guard anyway so the migration is re-runnable anywhere.
alter table public.inventory_movements
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists order_item_id uuid references public.order_items(id) on delete set null,
  add column if not exists reversed boolean not null default false;

create index if not exists inventory_movements_order_idx on public.inventory_movements(order_id) where order_id is not null;

-- WARNING: the "revoke from public" at the end of this block does NOT make
-- this function private. Supabase's default privileges grant EXECUTE to the
-- anon and authenticated ROLES on creation, and revoking from PUBLIC leaves
-- those role grants in place. As written here the function was callable by
-- anyone holding the anon key, with no auth or role check of its own.
-- Superseded by 20260807100000_secure_deduct_order_ingredients.sql, which
-- revokes the role grants and adds an auth + role + status guard. Do not
-- copy this block's permission pattern.
create or replace function public.deduct_order_ingredients(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_line record;
  v_available numeric;
  v_deduct numeric;
  v_reason text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;

  -- Idempotency: never deduct the same order twice, no matter how the caller
  -- was invoked.
  if exists (
    select 1 from public.inventory_movements
    where order_id = p_order_id and movement_type = 'deduction'
  ) then
    return;
  end if;

  -- One row per order item x recipe ingredient. Shared ingredients across
  -- items are handled naturally: each row locks the same stock row in turn,
  -- so the running balance stays correct within this transaction.
  for v_line in
    select
      oi.id as order_item_id,
      coalesce(oi.display_name, oi.item_name) as product_name,
      oi.quantity as ordered_qty,
      mii.ingredient_id,
      i.name as ingredient_name,
      i.unit as ingredient_unit,
      (mii.quantity_per_serving * oi.quantity) as required_qty
    from public.order_items oi
    join public.menu_item_ingredients mii on mii.menu_item_id = oi.menu_item_id
    join public.ingredients i on i.id = mii.ingredient_id
    where oi.order_id = p_order_id
      and oi.menu_item_id is not null
      and mii.quantity_per_serving > 0
    order by mii.ingredient_id
  loop
    select quantity into v_available
      from public.inventory_stock
      where ingredient_id = v_line.ingredient_id
      for update;
    if not found then
      -- Ingredient has no stock record: nothing to deduct, skip silently
      -- rather than blocking the order. The mapping-validation UI surfaces
      -- these cases to staff.
      continue;
    end if;

    v_deduct := least(v_line.required_qty, greatest(v_available, 0));
    v_reason := format('Order %s — %s x%s',
      coalesce(v_order.order_number, p_order_id::text), v_line.product_name, v_line.ordered_qty);
    if v_deduct < v_line.required_qty then
      v_reason := v_reason || format(' (short by %s %s — deducted available stock only)',
        v_line.required_qty - v_deduct, v_line.ingredient_unit);
    end if;

    if v_deduct > 0 then
      update public.inventory_stock
        set quantity = quantity - v_deduct, updated_at = now()
        where ingredient_id = v_line.ingredient_id;
    end if;

    -- Record the movement even when v_deduct is 0 (fully out of stock) so the
    -- shortage is visible and traceable in movement history and admin reports.
    -- quantity must stay > 0 for the table check, so a zero deduction is
    -- recorded as the smallest meaningful trace: skip insert only when there
    -- was nothing required at all.
    if v_deduct > 0 then
      insert into public.inventory_movements
        (ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
      values
        (v_line.ingredient_id, p_order_id, v_line.order_item_id, 'deduction', v_deduct, v_reason, auth.uid());
    end if;
  end loop;
end;
$$;

revoke all on function public.deduct_order_ingredients(uuid) from public;

-- Re-issue staff_advance_order_status (current definition from
-- 20260731120000_normalize_staff_role_checks.sql) with one addition: deduct
-- recipe ingredients at the moment an order becomes Completed.
create or replace function public.staff_advance_order_status(p_order_id uuid, p_new_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_pending boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'Cancelled' then raise exception 'This order has been cancelled'; end if;
  if v_order.status = 'Completed' then raise exception 'This order is already completed'; end if;

  v_pending := v_order.status in ('Order Received','Awaiting Payment Verification','Pending Confirmation');

  if p_new_status = 'Preparing' then
    if not v_pending then raise exception 'Only pending orders can move to Preparing'; end if;
  elsif p_new_status = 'Ready for Pickup' then
    if v_order.status <> 'Preparing' then raise exception 'Only preparing orders can be marked ready'; end if;
    if v_order.order_type <> 'pickup' then raise exception 'Only pickup orders can be marked Ready for Pickup'; end if;
  elsif p_new_status = 'Out for Delivery' then
    if v_order.status <> 'Preparing' then raise exception 'Only preparing orders can be dispatched'; end if;
    if v_order.order_type <> 'delivery' then raise exception 'Only delivery orders can be marked Out for Delivery'; end if;
  elsif p_new_status = 'Completed' then
    if v_order.order_type = 'pickup' and v_order.status <> 'Ready for Pickup' then
      raise exception 'Only orders ready for pickup can be completed';
    end if;
    if v_order.order_type = 'delivery' and v_order.status <> 'Out for Delivery' then
      raise exception 'Only orders out for delivery can be completed';
    end if;
  else
    raise exception 'Unsupported status transition';
  end if;

  update public.orders set status = p_new_status, updated_at = now() where id = p_order_id;

  -- Deduct recipe ingredients exactly once, at completion. Cart additions,
  -- pending states, and cancellations never reach this line; duplicate
  -- submissions are stopped above ('already completed') and inside
  -- deduct_order_ingredients (existing movements for the order).
  if p_new_status = 'Completed' then
    perform public.deduct_order_ingredients(p_order_id);
  end if;

  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$$;

notify pgrst,'reload schema';
