-- SECURITY FIX for 20260807090000_order_ingredient_deduction.sql
--
-- That migration shipped public.deduct_order_ingredients() with
--   revoke all on function ... from public;
-- and a comment claiming a client could not invoke it directly. Both were
-- wrong. Supabase applies
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
-- so every newly created function is granted EXECUTE to anon and
-- authenticated by role name. Revoking from PUBLIC does not touch those
-- role grants, so the function stayed callable by anyone holding the
-- anon key -- which ships in the browser bundle.
--
-- Verified against the live database: POSTing
--   /rest/v1/rpc/deduct_order_ingredients {"p_order_id": "<uuid>"}
-- with only the anon key reached the function body and raised the
-- function's own 'Order not found', proving execution as anon.
--
-- Impact of the hole: the function is SECURITY DEFINER, so it bypassed RLS
-- and had no auth or role check of its own. Anyone who knew or guessed an
-- order id (customers see their own in /orders/:id/track) could force a
-- stock deduction for that order at any time, in any status -- including
-- pending, unpaid, and cancelled orders, exactly the states that must
-- never deduct. Worse, because the function is idempotent per order, a
-- premature call would make the later legitimate completion find existing
-- deduction movements and skip, so the real completion would silently
-- deduct nothing.
--
-- The fix is applied at two independent layers, because either one alone
-- can be undone by a careless future 'grant execute on all functions':
--   1. Remove the EXECUTE grants from anon and authenticated.
--   2. Give the function its own auth and role guard, matching the
--      defence-in-depth pattern every other staff RPC in this project uses.
--
-- The legitimate call path is unaffected. staff_advance_order_status is
-- itself SECURITY DEFINER, so when it calls this function the EXECUTE
-- check runs against the owner (which retains the grant), while auth.uid()
-- still resolves from the caller's JWT -- so the role check below sees the
-- real staff member and passes.

-- Layer 1: drop the implicit grants.
revoke all on function public.deduct_order_ingredients(uuid) from public;
revoke all on function public.deduct_order_ingredients(uuid) from anon;
revoke all on function public.deduct_order_ingredients(uuid) from authenticated;

-- Layer 2: self-defence inside the function.
-- The accepted roles deliberately match staff_advance_order_status rather
-- than assert_inventory_writer(): a cashier is allowed to complete an
-- order, and completing an order is what triggers this function, so
-- excluding cashier here would break walk-in checkout.
create or replace function public.deduct_order_ingredients(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_line record;
  v_available numeric;
  v_deduct numeric;
  v_reason text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;

  -- Only a completed order may consume stock. This is a second, independent
  -- check: staff_advance_order_status already gates the transition, but if
  -- this function is ever called from anywhere else it must not deduct for a
  -- cart, a pending order, an unpaid order, or a cancelled one.
  if v_order.status <> 'Completed' then
    raise exception 'Only completed orders deduct ingredients (order is %)', v_order.status;
  end if;

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
      -- Ingredient has no stock record: nothing to deduct, skip rather than
      -- blocking the order. The mapping-validation UI surfaces these.
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

      insert into public.inventory_movements
        (ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
      values
        (v_line.ingredient_id, p_order_id, v_line.order_item_id, 'deduction', v_deduct, v_reason, auth.uid());
    end if;
    -- A fully out-of-stock ingredient records no movement, because
    -- inventory_movements.quantity carries a check (quantity > 0). The
    -- shortage is still visible through the availability engine, which marks
    -- the product 'missing_ingredient'. See the note in the module summary.
  end loop;
end;
$$;

-- Re-apply the revokes: create or replace re-runs the default privileges,
-- which would otherwise hand EXECUTE straight back to anon.
revoke all on function public.deduct_order_ingredients(uuid) from public;
revoke all on function public.deduct_order_ingredients(uuid) from anon;
revoke all on function public.deduct_order_ingredients(uuid) from authenticated;

notify pgrst,'reload schema';
