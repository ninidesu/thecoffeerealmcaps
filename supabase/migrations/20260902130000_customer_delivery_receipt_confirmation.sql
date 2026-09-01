-- Delivery completion belongs to the customer. Unconfirmed deliveries are
-- closed automatically 24 hours after dispatch so they do not remain active.

alter table public.orders
  add column if not exists out_for_delivery_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists receipt_confirmation text;

alter table public.orders
  drop constraint if exists orders_receipt_confirmation_check;
alter table public.orders
  add constraint orders_receipt_confirmation_check
  check (receipt_confirmation is null or receipt_confirmation in ('customer', 'automatic'));

update public.orders
set out_for_delivery_at = coalesce(out_for_delivery_at, updated_at, now())
where status = 'Out for Delivery'
  and out_for_delivery_at is null;

create or replace function public.track_order_delivery_receipt_timestamps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'Received' and (
    new.status is distinct from old.status
    or new.cancellation_status is distinct from old.cancellation_status
    or new.fulfillment_hold is distinct from old.fulfillment_hold
  ) then
    raise exception 'A received delivery cannot be changed or cancelled';
  end if;

  if new.status = 'Out for Delivery' and old.status is distinct from new.status then
    new.out_for_delivery_at := now();
  end if;

  if new.status = 'Received' and old.status is distinct from new.status then
    new.received_at := coalesce(new.received_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists track_order_delivery_receipt_timestamps_trigger on public.orders;
create trigger track_order_delivery_receipt_timestamps_trigger
before update on public.orders
for each row execute function public.track_order_delivery_receipt_timestamps();

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
  if v_order.fulfillment_hold or v_order.cancellation_status = 'requested' then
    raise exception 'This order is on hold for cancellation review';
  end if;
  if v_order.status = 'Cancelled' then raise exception 'This order has been cancelled'; end if;
  if v_order.status in ('Completed', 'Received') then raise exception 'This order is already finished'; end if;

  v_pending := v_order.status in ('Order Received','Awaiting Payment Verification','Pending Confirmation');
  if p_new_status = 'Preparing' then
    if not v_pending then raise exception 'Only pending orders can move to Preparing'; end if;
  elsif p_new_status = 'Ready for Pickup' then
    if v_order.status <> 'Preparing' then raise exception 'Only preparing orders can be marked ready'; end if;
    if v_order.order_type not in ('pickup', 'walk-in') then
      raise exception 'Only pickup or walk-in orders can be marked Ready for Pickup';
    end if;
  elsif p_new_status = 'Out for Delivery' then
    if v_order.status <> 'Preparing' then raise exception 'Only preparing orders can be dispatched'; end if;
    if v_order.order_type <> 'delivery' then raise exception 'Only delivery orders can be marked Out for Delivery'; end if;
  elsif p_new_status = 'Completed' then
    if v_order.order_type = 'delivery' then
      raise exception 'The customer must confirm receipt of a delivery order';
    end if;
    if v_order.order_type not in ('pickup', 'walk-in') or v_order.status <> 'Ready for Pickup' then
      raise exception 'Only pickup or walk-in orders ready for handoff can be completed';
    end if;
  else
    raise exception 'Unsupported status transition';
  end if;

  update public.orders set status = p_new_status, updated_at = now() where id = p_order_id;
  if p_new_status = 'Completed' then perform public.deduct_order_ingredients(p_order_id); end if;
  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$$;

revoke all on function public.staff_advance_order_status(uuid,text) from public;
grant execute on function public.staff_advance_order_status(uuid,text) to authenticated;

-- This remains an internal-only function. Its callers enforce staff, customer
-- ownership, or the scheduled system job before reaching this point.
create or replace function public.deduct_order_ingredients(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('Completed', 'Received') then
    raise exception 'Only completed or received orders deduct stock (order is %)', v_order.status;
  end if;

  for v_item in select id from public.order_items where order_id = p_order_id loop
    perform public.deduct_order_item_inventory(v_item.id);
  end loop;
end;
$$;

revoke all on function public.deduct_order_ingredients(uuid) from public;
revoke all on function public.deduct_order_ingredients(uuid) from anon;
revoke all on function public.deduct_order_ingredients(uuid) from authenticated;

create or replace function public.customer_confirm_order_received(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id and customer_id = auth.uid()
  for update;

  if not found then raise exception 'Order not found'; end if;
  if v_order.order_type <> 'delivery' then raise exception 'Only delivery orders require receipt confirmation'; end if;
  if v_order.status = 'Received' then
    return jsonb_build_object('id', p_order_id, 'status', 'Received', 'received_at', v_order.received_at);
  end if;
  if v_order.status <> 'Out for Delivery' then raise exception 'This order is not awaiting receipt confirmation'; end if;

  update public.payments
  set status = 'paid', confirmed_at = coalesce(confirmed_at, now()), confirmed_by = coalesce(confirmed_by, auth.uid())
  where order_id = p_order_id and method = 'cod';

  update public.orders
  set status = 'Received',
      received_at = now(),
      receipt_confirmation = 'customer',
      payment_status = case when exists (select 1 from public.payments where order_id = p_order_id and method = 'cod') then 'paid' else payment_status end,
      payment_confirmed = case when exists (select 1 from public.payments where order_id = p_order_id and method = 'cod') then true else payment_confirmed end,
      payment_confirmed_at = case when exists (select 1 from public.payments where order_id = p_order_id and method = 'cod') then coalesce(payment_confirmed_at, now()) else payment_confirmed_at end,
      updated_at = now()
  where id = p_order_id;

  perform public.deduct_order_ingredients(p_order_id);
  return jsonb_build_object('id', p_order_id, 'status', 'Received', 'received_at', now(), 'receipt_confirmation', 'customer');
end;
$$;

revoke all on function public.customer_confirm_order_received(uuid) from public;
revoke all on function public.customer_confirm_order_received(uuid) from anon;
grant execute on function public.customer_confirm_order_received(uuid) to authenticated;

create or replace function public.auto_receive_unconfirmed_delivery_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select id
    from public.orders
    where order_type = 'delivery'
      and status = 'Out for Delivery'
      and out_for_delivery_at <= now() - interval '24 hours'
    for update skip locked
  loop
    update public.orders
    set status = 'Received', received_at = now(), receipt_confirmation = 'automatic', updated_at = now()
    where id = v_order.id and status = 'Out for Delivery';

    if found then
      update public.payments
      set status = 'paid', confirmed_at = coalesce(confirmed_at, now())
      where order_id = v_order.id and method = 'cod';

      update public.orders
      set payment_status = case when exists (select 1 from public.payments where order_id = v_order.id and method = 'cod') then 'paid' else payment_status end,
          payment_confirmed = case when exists (select 1 from public.payments where order_id = v_order.id and method = 'cod') then true else payment_confirmed end,
          payment_confirmed_at = case when exists (select 1 from public.payments where order_id = v_order.id and method = 'cod') then coalesce(payment_confirmed_at, now()) else payment_confirmed_at end
      where id = v_order.id;

      perform public.deduct_order_ingredients(v_order.id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.auto_receive_unconfirmed_delivery_orders() from public;
revoke all on function public.auto_receive_unconfirmed_delivery_orders() from anon;
revoke all on function public.auto_receive_unconfirmed_delivery_orders() from authenticated;

drop policy if exists "Customers manage own feedback" on public.order_feedback;
create policy "Customers manage own feedback" on public.order_feedback
for all to authenticated
using (customer_id = auth.uid() and public.is_customer_profile())
with check (
  customer_id = auth.uid()
  and public.is_customer_profile()
  and exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.customer_id = auth.uid()
      and o.status in ('Completed', 'Received')
  )
);

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'auto-receive-delivery-orders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'auto-receive-delivery-orders',
  '*/5 * * * *',
  'select public.auto_receive_unconfirmed_delivery_orders();'
);

notify pgrst, 'reload schema';
