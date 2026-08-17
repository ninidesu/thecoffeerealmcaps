-- Cashier walk-in orders are paid and receipted at checkout, so they enter
-- staff preparation immediately instead of waiting in confirmation.

create or replace function public.route_cashier_walk_in_to_preparing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_source = 'cashier_pos' and new.order_type = 'walk-in' then
    new.status := 'Preparing';
  end if;
  return new;
end;
$$;

drop trigger if exists route_cashier_walk_in_to_preparing_trigger on public.orders;
create trigger route_cashier_walk_in_to_preparing_trigger
before insert on public.orders
for each row execute function public.route_cashier_walk_in_to_preparing();

update public.orders
set status = 'Preparing', updated_at = now()
where order_source = 'cashier_pos'
  and order_type = 'walk-in'
  and status = 'Ordered';

-- Walk-ins use the same preparation and ready handoff stages as pickup orders.
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
  if v_order.status = 'Completed' then raise exception 'This order is already completed'; end if;

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
    if v_order.order_type in ('pickup', 'walk-in') then
      if v_order.status <> 'Ready for Pickup' then
        raise exception 'Only orders ready for pickup can be completed';
      end if;
    elsif v_order.order_type = 'delivery' then
      if v_order.status <> 'Out for Delivery' then
        raise exception 'Only orders out for delivery can be completed';
      end if;
    else
      raise exception 'Unsupported order type';
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

notify pgrst, 'reload schema';
