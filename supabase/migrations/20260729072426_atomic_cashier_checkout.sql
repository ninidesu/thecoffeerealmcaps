-- Atomic cashier checkout. Pricing authority is hardened separately.

create or replace function public.create_cashier_order(request_payload jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_data jsonb:=coalesce(request_payload->'order','{}'::jsonb);
  payment_data jsonb:=coalesce(request_payload->'payment','{}'::jsonb);
  item_data jsonb;
  order_id uuid:=gen_random_uuid();
  saved_order_number text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role in ('admin','cashier')
  ) then raise exception 'Cashier access required'; end if;
  if jsonb_array_length(coalesce(request_payload->'items','[]'::jsonb))=0 then
    raise exception 'The cashier order has no items';
  end if;

  insert into public.orders (
    id,order_number,order_sequence,order_source,cashier_id,order_type,status,customer_name,
    subtotal,discount_type,discount_customer_name,discount_id_number,discount_subtotal,
    discount_amount,final_total,payment_status,payment_confirmed
  ) values (
    order_id,order_data->>'order_number',(order_data->>'order_sequence')::bigint,'cashier_pos',auth.uid(),
    'walk-in','Ordered',coalesce(nullif(btrim(order_data->>'customer_name'),''),'Walk-in Customer'),
    (order_data->>'subtotal')::numeric,nullif(order_data->>'discount_type',''),
    nullif(order_data->>'discount_customer_name',''),nullif(order_data->>'discount_id_number',''),
    coalesce((order_data->>'discount_subtotal')::numeric,0),coalesce((order_data->>'discount_amount')::numeric,0),
    (order_data->>'final_total')::numeric,'paid',true
  ) returning order_number into saved_order_number;

  for item_data in select * from jsonb_array_elements(request_payload->'items') loop
    insert into public.order_items (
      order_id,menu_item_id,item_name,unit_price,quantity,line_total,is_discounted,
      discount_amount,customizations,addons
    ) values (
      order_id,(item_data->>'menu_item_id')::uuid,item_data->>'item_name',
      (item_data->>'unit_price')::numeric,(item_data->>'quantity')::integer,
      (item_data->>'line_total')::numeric,coalesce((item_data->>'is_discounted')::boolean,false),
      coalesce((item_data->>'discount_amount')::numeric,0),coalesce(item_data->'customizations','{}'::jsonb),
      coalesce(item_data->'addons','[]'::jsonb)
    );
  end loop;

  insert into public.payments (
    order_id,method,amount_due,amount_received,change_amount,reference_number,
    account_number,bank_name,status,paid_at
  ) values (
    order_id,payment_data->>'method',(payment_data->>'amount_due')::numeric,
    (payment_data->>'amount_received')::numeric,coalesce((payment_data->>'change_amount')::numeric,0),
    nullif(payment_data->>'reference_number',''),nullif(payment_data->>'account_number',''),
    nullif(payment_data->>'bank_name',''),'paid',coalesce((payment_data->>'paid_at')::timestamptz,now())
  );

  return jsonb_build_object('id',order_id,'order_number',saved_order_number);
end;
$$;

revoke all on function public.create_cashier_order(jsonb) from public;
grant execute on function public.create_cashier_order(jsonb) to authenticated;
