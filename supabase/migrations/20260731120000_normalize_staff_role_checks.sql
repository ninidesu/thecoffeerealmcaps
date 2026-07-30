-- Fix "Operations access required" appearing for genuinely valid staff
-- accounts.
--
-- Root cause: every RPC added this session checked profiles.role with a
-- strict, case-sensitive equality list (role in ('admin','staff',...)).
-- The frontend route guard (normalizeRole() in src/lib/auth.js) is far more
-- forgiving — it lowercases, trims, and converts spaces/hyphens to
-- underscores (so "Operations Staff", "Staff", "operation-staff" etc. all
-- resolve to a valid role). A real staff account could pass the frontend
-- guard and see the board (RLS SELECT also uses a similarly loose check
-- elsewhere), then get rejected by these RPCs' stricter comparison the
-- moment it tried to write anything.
--
-- Fix: give Postgres the same normalization the frontend already uses, and
-- route every role check in this project through it.

create or replace function public.normalize_role(p_role text) returns text
language sql immutable as $$
  select case
    when regexp_replace(lower(btrim(coalesce(p_role, ''))), '[\s-]+', '_', 'g') in ('operations_staff','operation_staff')
      then 'operational_staff'
    else regexp_replace(lower(btrim(coalesce(p_role, ''))), '[\s-]+', '_', 'g')
  end;
$$;

create or replace function public.is_staff_profile() returns boolean
language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and public.normalize_role(role) in ('admin','cashier','staff','operational_staff')
  );
$$;

create or replace function public.assert_inventory_writer() returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff') then
    raise exception 'Inventory management access required';
  end if;
end;
$$;

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
  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$$;

create or replace function public.staff_confirm_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_method text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
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

create or replace function public.staff_cancel_order(p_order_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
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

create or replace function public.staff_resolve_cancellation(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  update public.orders
    set cancellation_resolved = true, cancellation_resolved_at = now(), cancellation_resolved_by = auth.uid()
    where id = p_order_id and status = 'Cancelled';
  if not found then raise exception 'Cancelled order not found'; end if;

  return jsonb_build_object('id', p_order_id, 'cancellation_resolved', true);
end;
$$;

notify pgrst,'reload schema';
