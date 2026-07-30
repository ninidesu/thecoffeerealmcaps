-- Customer-initiated order cancellation.
--
-- Before this migration, only staff/admin could cancel an order
-- (staff_cancel_order). Customers had no cancel path at all — MyOrdersPage
-- only linked to /orders/:id/track. This adds the missing pieces:
-- eligibility-gated cancellation, a refund-status field (never auto-claims a
-- refund happened), a dedicated audit table (in addition to the inline
-- orders.cancellation_* columns already used by staff cancellations), and a
-- one-time, idempotent inventory-restoration step for the (currently
-- unused, but schema-ready) case where stock was already deducted against
-- an order.

-- 1. Refund tracking and free-text cancellation notes (separate from the
--    fixed-option cancellation_reason so "Other" can carry an explanation).
alter table public.orders
  add column if not exists cancellation_notes text,
  add column if not exists refund_status text not null default 'not_applicable'
    check (refund_status in ('not_applicable','pending','processed','rejected'));

-- 2. Idempotency guard for inventory reversal: a deduction movement can only
--    ever be restored once.
alter table public.inventory_movements add column if not exists reversed boolean not null default false;

-- 3. Dedicated audit record, independent of the mutable orders row, exactly
--    matching what was asked for: order_id, customer_id, previous_status,
--    reason, notes, who cancelled, when, and the payment/refund snapshot at
--    the moment of cancellation.
create table if not exists public.order_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id),
  previous_status text not null,
  cancellation_reason text not null,
  cancellation_notes text,
  cancelled_by uuid references public.profiles(id),
  cancelled_by_role text not null,
  payment_status text,
  refund_status text not null default 'not_applicable',
  created_at timestamptz not null default now()
);
alter table public.order_cancellations enable row level security;
drop policy if exists "Customers read own cancellations" on public.order_cancellations;
create policy "Customers read own cancellations" on public.order_cancellations for select to authenticated
using (customer_id = auth.uid() or public.is_staff_profile());

-- 4. Customers may leave feedback once, only for their own completed order.
alter table public.order_feedback enable row level security;
create unique index if not exists order_feedback_one_per_order_uidx on public.order_feedback (order_id, customer_id);
drop policy if exists "Customers manage own feedback" on public.order_feedback;
create policy "Customers manage own feedback" on public.order_feedback for all to authenticated
using (customer_id = auth.uid() or public.is_staff_profile())
with check (
  customer_id = auth.uid()
  and exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid() and o.status = 'Completed')
);

-- 5. The cancellation itself. Ownership is enforced here, not only by RLS —
--    a customer can never cancel another customer's order even if a bug
--    elsewhere exposed the id. Eligibility is intentionally narrower than
--    staff cancellation: only the pre-preparation pending states qualify.
create or replace function public.customer_cancel_order(
  p_order_id uuid, p_reason text, p_notes text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_method text;
  v_refund_status text;
  v_movement record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_reason = '' then raise exception 'A cancellation reason is required'; end if;
  if lower(v_reason) = 'other' and v_notes is null then
    raise exception 'Please describe your reason for cancelling';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.customer_id is null or v_order.customer_id <> auth.uid() then
    raise exception 'You can only cancel your own orders';
  end if;
  if v_order.status not in ('Order Received','Awaiting Payment Verification','Pending Confirmation') then
    raise exception 'This order can no longer be cancelled because preparation may have already started';
  end if;

  select method into v_method from public.payments where order_id = p_order_id order by created_at desc limit 1;
  -- A verified/paid amount needs an actual refund; an unpaid COD order or an
  -- unverified GCash/Bank proof was never charged, so there is nothing to
  -- refund — the uploaded proof itself is left untouched either way.
  v_refund_status := case when v_order.payment_confirmed then 'pending' else 'not_applicable' end;

  update public.orders set
    status = 'Cancelled',
    cancellation_reason = v_reason,
    cancellation_notes = v_notes,
    cancelled_by = auth.uid(),
    cancelled_by_role = 'Customer',
    cancelled_at = now(),
    cancellation_resolved = false,
    refund_status = v_refund_status,
    updated_at = now()
  where id = p_order_id;

  insert into public.order_cancellations (order_id, customer_id, previous_status, cancellation_reason, cancellation_notes, cancelled_by, cancelled_by_role, payment_status, refund_status)
  values (p_order_id, auth.uid(), v_order.status, v_reason, v_notes, auth.uid(), 'Customer', v_order.payment_status, v_refund_status);

  -- Idempotent, schema-ready inventory reversal: today create_customer_order
  -- never deducts stock, so this loop matches zero rows and is a no-op. If a
  -- future change starts recording deductions against orders (inventory_movements
  -- already has the order_id column for exactly this), reversal will work
  -- automatically without another migration, and reversed=true prevents any
  -- movement from ever being restored twice.
  for v_movement in
    select * from public.inventory_movements
    where order_id = p_order_id and movement_type = 'deduction' and not reversed
    for update
  loop
    update public.inventory_stock set quantity = quantity + v_movement.quantity, updated_at = now()
      where ingredient_id = v_movement.ingredient_id;
    update public.inventory_movements set reversed = true where id = v_movement.id;
    insert into public.inventory_movements (ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
      values (v_movement.ingredient_id, p_order_id, v_movement.order_item_id, 'restock', v_movement.quantity, 'Order cancelled — stock restored', auth.uid());
  end loop;

  return jsonb_build_object('id', p_order_id, 'status', 'Cancelled', 'refund_status', v_refund_status);
end;
$$;

-- 6. Staff mark a pending refund as processed (or rejected), once the actual
--    refund has been sent outside this system (e.g. GCash transfer back).
create or replace function public.staff_update_refund_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff') then
    raise exception 'Operations access required';
  end if;
  if p_status not in ('processed','rejected') then raise exception 'Unsupported refund status'; end if;

  update public.orders set refund_status = p_status, updated_at = now()
    where id = p_order_id and status = 'Cancelled' and refund_status = 'pending';
  if not found then raise exception 'No pending refund found for this order'; end if;

  return jsonb_build_object('id', p_order_id, 'refund_status', p_status);
end;
$$;

revoke all on function public.customer_cancel_order(uuid,text,text) from public;
revoke all on function public.staff_update_refund_status(uuid,text) from public;
grant execute on function public.customer_cancel_order(uuid,text,text) to authenticated;
grant execute on function public.staff_update_refund_status(uuid,text) to authenticated;

notify pgrst,'reload schema';
