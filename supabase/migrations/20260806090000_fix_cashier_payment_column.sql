-- Fix cashier checkout for deployments whose payments table has no cashier_id column.
-- Cashier attribution is stored on orders.cashier_id.

-- Atomic, server-authoritative cashier checkout.
create or replace function public.create_cashier_order(request_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 o jsonb:=coalesce(request_payload->'order','{}'); p jsonb:=coalesce(request_payload->'payment','{}'); i jsonb; m public.menu_items%rowtype;
 oid uuid:=gen_random_uuid(); ono text:='WI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 q integer; total_q integer:=0; base numeric(12,2); adds numeric(12,2); unit numeric(12,2); line numeric(12,2); sub numeric(12,2):=0;
 dtype text:=nullif(btrim(o->>'discount_type'),''); discount numeric(12,2):=0; grand numeric(12,2);
 method text:=lower(btrim(coalesce(p->>'method',''))); received numeric(12,2); change_due numeric(12,2);
 requested_addons integer; valid_addons integer; temperature text; variant text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','cashier')) then raise exception 'Cashier access required'; end if;
 if jsonb_array_length(coalesce(request_payload->'items','[]'))=0 then raise exception 'The cashier order has no items'; end if;
 for i in select * from jsonb_array_elements(request_payload->'items') loop
  begin q:=(i->>'quantity')::integer; exception when others then raise exception 'Every item must have a valid quantity'; end;
  if q<1 or q>99 then raise exception 'Item quantity must be between 1 and 99'; end if;
  total_q:=total_q+q; if total_q>200 then raise exception 'An order cannot contain more than 200 items'; end if;
  select * into m from public.menu_items where id=(i->>'menu_item_id')::uuid and is_available=true and is_archived=false;
  if not found then raise exception 'A selected menu item is unavailable'; end if;
  base:=m.price; variant:=nullif(btrim(i->'customizations'->>'variantKey'),'');
  if variant is not null then
   if not (m.variant_options?'prices' and (m.variant_options->'prices')?variant) then raise exception 'A selected item variant is unavailable'; end if;
   base:=(m.variant_options->'prices'->>variant)::numeric;
  end if;
  temperature:=lower(btrim(coalesce(i->'customizations'->>'temperature','')));
  if m.temperature_type='iced_only' and temperature not in ('cold','iced') then raise exception 'This item requires a cold temperature'; end if;
  if m.temperature_type='hot_only' and temperature<>'hot' then raise exception 'This item requires a hot temperature'; end if;
  if m.temperature_type='flexible' and temperature not in ('hot','cold','iced') then raise exception 'Select a valid item temperature'; end if;
  select count(distinct lower(btrim(x->>'name'))) into requested_addons from jsonb_array_elements(coalesce(i->'addons','[]')) x;
  if requested_addons>0 and not coalesce(m.allow_addons,false) then raise exception 'Add-ons are not allowed for this item'; end if;
  select count(*),coalesce(sum(a.price),0) into valid_addons,adds from public.addons a
   where lower(a.name) in(select lower(btrim(x->>'name')) from jsonb_array_elements(coalesce(i->'addons','[]')) x)
   and a.is_available=true and a.applies_to in ('both',m.item_type)
   and (a.target_temperature='both' or (a.target_temperature in ('iced','cold') and temperature in ('iced','cold')) or (a.target_temperature='hot' and temperature='hot'));
  if valid_addons<>requested_addons then raise exception 'One or more selected add-ons are unavailable for this item'; end if;
  sub:=sub+((base+adds)*q);
 end loop;
 if dtype is not null then
  if dtype not in ('PWD','Senior') then raise exception 'Unsupported discount type'; end if;
  if nullif(btrim(o->>'discount_customer_name'),'') is null or nullif(btrim(o->>'discount_id_number'),'') is null then raise exception 'Discount customer name and ID number are required'; end if;
  discount:=round(sub*0.20,2);
 end if;
 grand:=sub-discount;
 if method not in ('cash','gcash','bank_transfer') then raise exception 'Unsupported payment method'; end if;
 if method='cash' then
  received:=coalesce((p->>'amount_received')::numeric,0); if received<grand then raise exception 'Cash received is less than the total'; end if; change_due:=received-grand;
 elsif method='gcash' then
  if coalesce(p->>'reference_number','') !~ '^[0-9]{13}$' then raise exception 'GCash reference number must be exactly 13 digits'; end if; received:=grand; change_due:=0;
 else
  if nullif(btrim(p->>'bank_name'),'') is null then raise exception 'Bank name is required'; end if;
  if coalesce(p->>'reference_number','') !~ '^[A-Za-z0-9-]{6,30}$' then raise exception 'Bank reference must be 6 to 30 letters, numbers, or hyphens'; end if; received:=grand; change_due:=0;
 end if;
 insert into public.orders(id,order_number,order_sequence,order_source,cashier_id,order_type,status,customer_name,subtotal,discount_type,discount_customer_name,discount_id_number,discount_subtotal,discount_amount,final_total,payment_status,payment_confirmed)
 values(oid,ono,floor(extract(epoch from clock_timestamp()))::bigint,'cashier_pos',auth.uid(),'walk-in','Ordered',coalesce(nullif(btrim(o->>'customer_name'),''),'Walk-in Customer'),sub,dtype,nullif(btrim(o->>'discount_customer_name'),''),nullif(btrim(o->>'discount_id_number'),''),case when dtype is null then 0 else sub end,discount,grand,'paid',true);
 for i in select * from jsonb_array_elements(request_payload->'items') loop
  select * into m from public.menu_items where id=(i->>'menu_item_id')::uuid; q:=(i->>'quantity')::integer; base:=m.price; variant:=nullif(btrim(i->'customizations'->>'variantKey'),'');
  if variant is not null then base:=(m.variant_options->'prices'->>variant)::numeric; end if;
  select coalesce(sum(a.price),0) into adds from public.addons a where lower(a.name) in(select lower(btrim(x->>'name')) from jsonb_array_elements(coalesce(i->'addons','[]')) x) and a.is_available=true;
  unit:=base+adds; line:=unit*q;
  insert into public.order_items(order_id,menu_item_id,item_name,unit_price,quantity,line_total,is_discounted,discount_amount,customizations,addons)
  values(oid,m.id,m.name,unit,q,line,dtype is not null,case when dtype is null then 0 else round(line*0.20,2) end,coalesce(i->'customizations','{}'),coalesce(i->'addons','[]'));
 end loop;
 insert into public.payments(order_id,method,amount_due,amount_received,change_amount,reference_number,account_number,bank_name,status,paid_at)
 values(oid,method,grand,received,change_due,nullif(p->>'reference_number',''),nullif(p->>'account_number',''),nullif(p->>'bank_name',''),'paid',now());
 return jsonb_build_object('id',oid,'order_number',ono,'subtotal',sub,'discount_amount',discount,'total',grand,'change_amount',change_due);
end; $$;
revoke all on function public.create_cashier_order(jsonb) from public;
grant execute on function public.create_cashier_order(jsonb) to authenticated;
