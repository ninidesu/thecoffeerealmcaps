-- Server-authoritative 20% Senior Citizen/PWD discount for one eligible item.
create or replace function public.create_customer_order_with_benefit_discount(request_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
  order_id uuid;
  benefit_kind text;
  target_item uuid;
  target_unit numeric(12,2);
  discount numeric(12,2):=0;
  order_row public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce((request_payload->>'apply_benefit_discount')::boolean,false) then
    select kind into benefit_kind from public.benefit_applications where customer_id=auth.uid() and status='approved' limit 1;
    if not found then raise exception 'Senior Citizen/PWD verification is not approved'; end if;
  end if;
  result:=public.create_customer_order(request_payload-'apply_benefit_discount');
  if not coalesce((request_payload->>'apply_benefit_discount')::boolean,false) then return result; end if;
  order_id:=(result->>'id')::uuid;
  select * into order_row from public.orders where id=order_id for update;
  select oi.id,oi.unit_price into target_item,target_unit from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=order_id and mi.online_benefit_eligible order by oi.unit_price desc,oi.id limit 1;
  if target_item is null then raise exception 'No eligible item in this order'; end if;
  discount:=round(target_unit*0.20,2);
  update public.order_items set line_total=line_total-discount,is_discounted=true,discount_amount=discount where id=target_item;
  update public.orders set discount_type=case when benefit_kind='pwd' then 'PWD' else 'Senior' end,discount_customer_name=order_row.customer_name,discount_subtotal=order_row.subtotal,discount_amount=discount,final_total=order_row.final_total-discount,updated_at=now() where id=order_id;
  update public.payments set amount_due=amount_due-discount where order_id=order_id;
  return result||jsonb_build_object('discount_amount',discount,'total',order_row.final_total-discount);
end; $$;
revoke all on function public.create_customer_order_with_benefit_discount(jsonb) from public;
grant execute on function public.create_customer_order_with_benefit_discount(jsonb) to authenticated;
