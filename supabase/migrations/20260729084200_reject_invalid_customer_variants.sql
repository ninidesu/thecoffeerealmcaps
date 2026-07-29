-- Reject unknown customer menu variants instead of silently charging the base price.
create or replace function public.create_customer_order(request_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb:=coalesce(request_payload->'customer','{}'::jsonb); i jsonb; m public.menu_items%rowtype;
  oid uuid:=gen_random_uuid(); ono text:='CR-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  q integer; total_q integer:=0; unit numeric(12,2); adds numeric(12,2); line numeric(12,2); sub numeric(12,2):=0;
  requested_addon_count integer; valid_addon_count integer; selected_temperature text;
  fee numeric(12,2):=0; grand numeric(12,2); pay text:=lower(btrim(coalesce(request_payload->>'payment_method','gcash')));
  fulfill text:=lower(btrim(coalesce(request_payload->>'fulfillment_method','delivery'))); order_status text;
  requested_barangay text:=btrim(coalesce(c->>'barangay',''));
  v_request_key uuid; v_schedule_date date; v_schedule_time time; manila_now timestamp; lead_time interval; existing_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  begin v_request_key:=nullif(request_payload->>'request_key','')::uuid; exception when others then raise exception 'Invalid checkout request key'; end;
  if v_request_key is null then raise exception 'Checkout request key is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||v_request_key::text,0));
  select * into existing_order from public.orders existing where existing.customer_id=auth.uid() and existing.request_key=v_request_key;
  if found then return jsonb_build_object('id',existing_order.id,'order_id',existing_order.id,'order_number',existing_order.order_number,'subtotal',existing_order.subtotal,'delivery_fee',existing_order.delivery_fee,'total',existing_order.final_total,'status',existing_order.status); end if;
  if jsonb_array_length(coalesce(request_payload->'items','[]'::jsonb))=0 then raise exception 'The order has no items'; end if;
  if fulfill not in ('delivery','pickup') then raise exception 'Unsupported fulfillment method'; end if;
  if pay not in ('cod','gcash','bank_transfer') then raise exception 'Unsupported payment method'; end if;
  if pay='cod' and fulfill<>'delivery' then raise exception 'Cash on Delivery is available for delivery orders only'; end if;
  begin
    v_schedule_date:=nullif(c->>'scheduleDate','')::date;
    v_schedule_time:=nullif(c->>'scheduleTime','')::time;
  exception when others then raise exception 'Invalid schedule date or time'; end;
  if v_schedule_date is null or v_schedule_time is null then raise exception 'A schedule date and time are required'; end if;
  manila_now:=clock_timestamp() at time zone 'Asia/Manila';
  lead_time:=case when fulfill='delivery' then interval '60 minutes' else interval '30 minutes' end;
  if v_schedule_date not in (manila_now::date,(manila_now::date+1)) then raise exception 'Schedule must be today or tomorrow'; end if;
  if v_schedule_time<'10:00'::time or v_schedule_time>'23:30'::time or extract(minute from v_schedule_time) not in (0,30) or extract(second from v_schedule_time)<>0 then raise exception 'Select a valid 30-minute store schedule between 10:00 AM and 11:30 PM'; end if;
  if (v_schedule_date+v_schedule_time) <= (manila_now+lead_time) then raise exception 'The selected schedule does not provide enough preparation time'; end if;
  if fulfill='delivery' then
    select da.fee into fee
    from public.delivery_areas da
    where lower(da.barangay)=lower(requested_barangay) and da.is_active=true;
    if not found then raise exception 'The selected delivery area is unavailable'; end if;
  else
    fee:=0;
  end if;
  order_status:=case when pay='cod' then 'Preparing' else 'Pending Confirmation' end;
  for i in select * from jsonb_array_elements(request_payload->'items') loop
    select * into m from public.menu_items where id=(i->>'product_id')::uuid and is_available=true and is_archived=false;
    if not found then raise exception 'A selected menu item is unavailable'; end if;
    begin q:=(i->>'quantity')::integer; exception when others then raise exception 'Every item must have a valid quantity'; end;
    if q<1 or q>99 then raise exception 'Item quantity must be between 1 and 99'; end if;
    total_q:=total_q+q; if total_q>200 then raise exception 'An order cannot contain more than 200 items'; end if;
    unit:=m.price;
    selected_temperature:=lower(btrim(coalesce(i->>'temperature','')));
    if m.temperature_type='iced_only' and selected_temperature not in ('cold','iced') then raise exception 'This item requires a cold temperature'; end if;
    if m.temperature_type='hot_only' and selected_temperature<>'hot' then raise exception 'This item requires a hot temperature'; end if;
    if m.temperature_type='flexible' and selected_temperature not in ('hot','cold','iced') then raise exception 'Select a valid item temperature'; end if;
    if nullif(i->>'variation_id','') is not null then
      if not (m.variant_options?'prices' and (m.variant_options->'prices')?(i->>'variation_id')) then raise exception 'A selected item variant is unavailable'; end if;
      unit:=(m.variant_options->'prices'->>(i->>'variation_id'))::numeric;
    end if;
    select count(distinct addon_id) into requested_addon_count from jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb)) as requested(addon_id);
    if requested_addon_count>0 and not coalesce(m.allow_addons,false) then raise exception 'Add-ons are not allowed for this item'; end if;
    select count(*),coalesce(sum(price),0) into valid_addon_count,adds from (
      select a.id::text as id,a.price from public.addons a where a.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) and a.is_available=true
        and a.applies_to in ('both',m.item_type)
        and (a.target_temperature='both' or (a.target_temperature in ('iced','cold') and selected_temperature in ('iced','cold')) or (a.target_temperature='hot' and selected_temperature='hot'))
      union all
      select x.id::text as id,x.price from public.menu_items x join public.subcategories xs on xs.id=x.subcategory_id
        where x.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) and x.is_available=true and x.is_archived=false and xs.name='add_ons' and x.item_type=m.item_type
    ) p;
    if valid_addon_count<>requested_addon_count then raise exception 'One or more selected add-ons are not allowed for this item'; end if;
    sub:=sub+((unit+adds)*q);
  end loop;
  grand:=sub+fee;
  if pay='cod' and grand>1000 then raise exception 'Cash on Delivery is limited to orders of 1000 pesos or less'; end if;
  insert into public.orders (id,order_number,order_source,order_type,status,customer_id,request_key,customer_name,customer_email,customer_phone,delivery_address,delivery_fee,schedule_date,schedule_time,subtotal,final_total,payment_status,payment_confirmed)
  values (oid,ono,'customer_pos',fulfill,order_status,auth.uid(),v_request_key,c->>'fullName',c->>'email',c->>'contact',case when fulfill='delivery' then concat_ws(', ',c->>'address','Brgy. '||(c->>'barangay'),c->>'city',c->>'province',c->>'postal') else null end,fee,v_schedule_date,v_schedule_time,sub,grand,'pending',false);
  insert into public.payments(order_id,method,amount_due,status) values(oid,pay,grand,'pending');
  for i in select * from jsonb_array_elements(request_payload->'items') loop
    select * into m from public.menu_items where id=(i->>'product_id')::uuid; q:=(i->>'quantity')::integer; unit:=m.price;
    selected_temperature:=lower(btrim(coalesce(i->>'temperature','')));
    if nullif(i->>'variation_id','') is not null then
      if not (m.variant_options?'prices' and (m.variant_options->'prices')?(i->>'variation_id')) then raise exception 'A selected item variant is unavailable'; end if;
      unit:=(m.variant_options->'prices'->>(i->>'variation_id'))::numeric;
    end if;
    select coalesce(sum(price),0) into adds from (
      select a.price from public.addons a where a.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) and a.is_available=true
        and a.applies_to in ('both',m.item_type)
        and (a.target_temperature='both' or (a.target_temperature in ('iced','cold') and selected_temperature in ('iced','cold')) or (a.target_temperature='hot' and selected_temperature='hot'))
      union all
      select x.price from public.menu_items x join public.subcategories xs on xs.id=x.subcategory_id
        where x.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) and x.is_available=true and x.is_archived=false and xs.name='add_ons' and x.item_type=m.item_type
    ) p;
    line:=(unit+adds)*q;
    insert into public.order_items(order_id,product_id,product_name,name,unit_price,price,quantity,qty,line_total,addons,customizations)
    values(oid,m.id,m.name,m.name,unit,unit,q,q,line,coalesce(i->'addon_ids','[]'::jsonb),jsonb_build_object('variation_id',i->>'variation_id','temperature',i->>'temperature','special_instructions',i->>'special_instructions'));
  end loop;
  return jsonb_build_object('id',oid,'order_id',oid,'order_number',ono,'subtotal',sub,'delivery_fee',fee,'total',grand,'status',order_status);
end; $$;
