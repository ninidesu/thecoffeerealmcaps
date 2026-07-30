-- Root cause fix for "insert or update on table orders violates foreign key
-- constraint orders_customer_id_fkey".
--
-- The live orders_customer_id_fkey constraint references public.profiles(id),
-- not auth.users(id) (confirmed from the live Postgres error detail: `Key
-- (customer_id)=(...) is not present in table "profiles".`). Nothing in this
-- codebase ever inserted a public.profiles row for a customer account created
-- through the normal signup flow (CustomerLoginPage.jsx -> supabase.auth.signUp)
-- — only staff accounts (provisioned separately) have one. So a customer can
-- authenticate successfully (auth.users has their row, supabase.auth.getUser()
-- succeeds) and still fail at checkout because auth.uid() has no matching
-- public.profiles row for the orders FK to point at.
--
-- This migration:
--   1. Backfills a profiles row for every existing auth.users row that is
--      missing one (fixes already-registered, currently-broken accounts).
--   2. Adds a trigger so every future signup gets a profiles row
--      automatically — this is the actual fix, not a workaround.
--   3. Updates the customer order guard to check public.profiles (the table
--      actually enforced by the FK) instead of auth.users.
--   4. Adds RLS so customers can read/update their own profile row, with a
--      trigger guard preventing a customer from escalating their own role.
--
-- No table is recreated, no existing data is modified/deleted, no RLS is
-- disabled.

-- 1. Backfill: create a profiles row for any existing account missing one.
--    username is intentionally left unset here: it is unique, its value is
--    cosmetic (login is by email, not username), and guessing one from
--    metadata risks colliding with an unrelated account that already claimed
--    the same username string. Bare ON CONFLICT DO NOTHING (no arbiter) skips
--    any row that still collides on some other constraint instead of failing
--    the whole backfill.
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', split_part(u.email,'@',1)),
  coalesce(nullif(u.raw_user_meta_data->>'role',''), 'customer')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

-- 2. Auto-provision a profile for every new signup going forward.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    coalesce(nullif(new.raw_user_meta_data->>'role',''), 'customer')
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- 3. The order functions should check the table the FK actually points to.
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
  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    -- Self-heal instead of hard-failing: this closes the gap for any account
    -- that predates the trigger above and was not covered by the backfill.
    insert into public.profiles (id, email, role)
    select auth.uid(), u.email, 'customer' from auth.users u where u.id = auth.uid()
    on conflict (id) do nothing;
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    raise exception 'Your account session is no longer valid. Please log in again to continue.';
  end if;
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

create or replace function public.attach_customer_payment_proof(p_order_id uuid,p_path text) returns void
language plpgsql security definer set search_path=public as $$ begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    raise exception 'Your account session is no longer valid. Please log in again to continue.';
  end if;
  perform 1 from public.orders o join public.payments p on p.order_id=o.id
  where o.id=p_order_id and o.customer_id=auth.uid() and p.method in ('gcash','bank_transfer')
    and o.status='Pending Confirmation' and not coalesce(o.payment_confirmed,false) and o.payment_proof_path is null;
  if not found then raise exception 'Eligible order not found or not owned by the signed-in customer'; end if;
  if p_path is null or p_path !~ ('^'||auth.uid()::text||'/'||p_order_id::text||'_[0-9]{8}[.](jpg|png|webp)$') then
    raise exception 'Invalid payment proof path';
  end if;
  perform 1 from storage.objects so where so.bucket_id='payment-proofs' and so.name=p_path
    and lower(coalesce(so.metadata->>'mimetype','')) in ('image/jpeg','image/png','image/webp');
  if not found then raise exception 'Payment proof object was not found'; end if;
  update public.orders set payment_proof_path=p_path,payment_status='pending',payment_confirmed=false,updated_at=now()
  where id=p_order_id and customer_id=auth.uid();
  if not found then raise exception 'Order not found or not owned by the signed-in customer'; end if;
end; $$;

revoke all on function public.create_customer_order(jsonb) from public;
revoke all on function public.attach_customer_payment_proof(uuid,text) from public;
grant execute on function public.create_customer_order(jsonb) to authenticated;
grant execute on function public.attach_customer_payment_proof(uuid,text) to authenticated;

-- 4. Customers can read/update their own profile; role changes are blocked
--    unless the caller is already an admin (defense against self-escalation
--    via a direct REST PATCH to /profiles).
alter table public.profiles enable row level security;

drop policy if exists "Customers read own profile" on public.profiles;
create policy "Customers read own profile" on public.profiles for select to authenticated
using (id = auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));

drop policy if exists "Customers update own profile" on public.profiles;
create policy "Customers update own profile" on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create or replace function public.prevent_profile_role_self_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profile_role_self_escalation_trigger on public.profiles;
create trigger prevent_profile_role_self_escalation_trigger
before update on public.profiles
for each row execute function public.prevent_profile_role_self_escalation();

notify pgrst,'reload schema';
