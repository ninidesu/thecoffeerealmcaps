-- Operations Staff order workflow: status transitions, payment verification,
-- and cancellation, backed by real Supabase data.
--
-- Root gap found before this migration: no RPC or RLS policy anywhere let
-- staff/admin/cashier change an order's status, confirm a payment, or cancel
-- an order — the "Order Preparation" page was 100% hardcoded mock data.
-- Direct table UPDATEs from the client are intentionally NOT opened up here
-- (same reasoning as the customer checkout RPCs): status transitions must be
-- validated server-side so a client can't jump an order to an invalid state.

-- 1. Track who resolved a cancellation and what role cancelled the order,
--    without requiring a join at read time.
alter table public.orders
  add column if not exists cancelled_by_role text,
  add column if not exists cancellation_resolved boolean not null default false,
  add column if not exists cancellation_resolved_at timestamptz,
  add column if not exists cancellation_resolved_by uuid references auth.users(id) on delete set null;

-- 2. Legal status transitions, enforced server-side. Kept intentionally
--    aligned with the customer-facing tracker in CustomerPages.jsx
--    (trackingSteps/orderStatusLabel) so this never desyncs from what
--    customers already see:
--      pickup:   Order Received/Awaiting Payment Verification -> Preparing -> Ready for Pickup -> Completed
--      delivery: Order Received/Awaiting Payment Verification -> Preparing -> Out for Delivery -> Completed
--    'Pending Confirmation' is accepted as a legacy synonym for the initial
--    pending states (rows created before the status wording was finalized).
create or replace function public.staff_advance_order_status(p_order_id uuid, p_new_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_pending boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff','cashier') then
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
  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$$;

-- 3. Verifying a GCash/Bank payment (or confirming a COD order) both land the
--    order in the same place — Preparing — but only a payment that actually
--    needs verification gets marked paid/confirmed here. COD has nothing to
--    verify: it is paid on delivery, never through this function.
create or replace function public.staff_confirm_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_method text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('Order Received','Awaiting Payment Verification','Pending Confirmation') then
    raise exception 'This order is not awaiting confirmation';
  end if;

  select method into v_method from public.payments where order_id = p_order_id order by created_at desc limit 1;

  if v_method in ('gcash','bank_transfer') then
    if v_order.payment_proof_path is null then
      raise exception 'Payment proof has not been uploaded yet';
    end if;
    update public.orders
      set status = 'Preparing', payment_status = 'paid', payment_confirmed = true,
          payment_confirmed_at = now(), updated_at = now()
      where id = p_order_id;
    update public.payments set status = 'paid', confirmed_at = now(), confirmed_by = auth.uid()
      where order_id = p_order_id;
  else
    update public.orders set status = 'Preparing', updated_at = now() where id = p_order_id;
  end if;

  return jsonb_build_object('id', p_order_id, 'status', 'Preparing');
end;
$$;

-- 4. Cancellation always requires a reason, is only allowed before an order
--    completes, and records who cancelled (role snapshotted onto the row so
--    the UI can show "Cancelled by Operations Staff" without a join).
create or replace function public.staff_cancel_order(p_order_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;
  if v_reason = '' then raise exception 'A cancellation reason is required'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'Cancelled' then raise exception 'This order is already cancelled'; end if;
  if v_order.status = 'Completed' then raise exception 'A completed order cannot be cancelled'; end if;

  update public.orders set
    status = 'Cancelled',
    cancellation_reason = v_reason,
    cancelled_by = auth.uid(),
    cancelled_by_role = 'Operations Staff',
    cancelled_at = now(),
    cancellation_resolved = false,
    updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('id', p_order_id, 'status', 'Cancelled');
end;
$$;

-- 5. Mark a cancelled order's follow-up (refund/acknowledgement) as done.
create or replace function public.staff_resolve_cancellation(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  update public.orders
    set cancellation_resolved = true, cancellation_resolved_at = now(), cancellation_resolved_by = auth.uid()
    where id = p_order_id and status = 'Cancelled';
  if not found then raise exception 'Cancelled order not found'; end if;

  return jsonb_build_object('id', p_order_id, 'cancellation_resolved', true);
end;
$$;

revoke all on function public.staff_advance_order_status(uuid,text) from public;
revoke all on function public.staff_confirm_order(uuid) from public;
revoke all on function public.staff_cancel_order(uuid,text) from public;
revoke all on function public.staff_resolve_cancellation(uuid) from public;
grant execute on function public.staff_advance_order_status(uuid,text) to authenticated;
grant execute on function public.staff_confirm_order(uuid) to authenticated;
grant execute on function public.staff_cancel_order(uuid,text) to authenticated;
grant execute on function public.staff_resolve_cancellation(uuid) to authenticated;

-- 6. Staff/admin/cashier can view any customer's payment proof image. The
--    existing storage policies (20260729070152_security_hardening.sql) only
--    let the uploading customer view their own file, so operations staff had
--    no way to see proof of payment at all — that's the gap this closes.
drop policy if exists "Staff view all payment proofs" on storage.objects;
create policy "Staff view all payment proofs" on storage.objects for select to authenticated
using (bucket_id = 'payment-proofs' and public.is_staff_profile());

notify pgrst,'reload schema';
