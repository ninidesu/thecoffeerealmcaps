-- Security hardening deployment: delivery pricing, OTP controls, and customer order validation.

-- 1. Server-authoritative delivery areas.
-- Canonical server-side delivery pricing.
-- The order RPC reads this table and never trusts a fee supplied by the client.

create table if not exists public.delivery_areas (
  barangay text primary key,
  zone text not null,
  fee numeric(12,2) not null check (fee >= 0),
  estimated_time text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.delivery_areas (barangay, zone, fee, estimated_time)
select barangay, 'Zone 1', 60, '10-20 mins'
from unnest(array[
  'Bagbag','Bahay Toro','Batasan Hills','Commonwealth','Holy Spirit','Payatas',
  'Bagong Silangan','Capri','Fairview','Greater Lagro','Gulod','Kaligayahan',
  'Nagkaisang Nayon','North Fairview','Novaliches Proper','Pasong Putik Proper',
  'San Agustin','San Bartolome','Sauyo','Santa Lucia','Santa Monica','Talipapa',
  'Tandang Sora','Culiat','Matandang Balara','Pasong Tamo'
]) as barangay
on conflict (barangay) do update set
  zone=excluded.zone, fee=excluded.fee, estimated_time=excluded.estimated_time,
  is_active=true, updated_at=now();

insert into public.delivery_areas (barangay, zone, fee, estimated_time)
select barangay, 'Zone 2', 80, '20-40 mins'
from unnest(array[
  'Alicia','Amihan','Apolonio Samson','Aurora','Bagong Pag-asa','Baesa',
  'Balingasa','Balintawak','Bambang','Bungad','Damar','Damayan','Damayang Lagi',
  'Del Monte','Dioquino Zobel','Don Manuel','Dona Aurora','Dona Faustina',
  'Dona Imelda','Dona Josefa','Duyan-Duyan','Immaculate Concepcion','Kaunlaran',
  'Lourdes','Maharlika','Manresa','Mariblo','Masambong','Milagrosa',
  'N.S. Amoranto','Nayon Kanluran','Paang Bundok','Pag-ibig sa Nayon','Paltok',
  'Paraiso','Phil-Am','Project 6','Ramon Magsaysay','Salvacion','San Antonio',
  'San Isidro Labrador','San Jose','San Martin de Porres','San Roque',
  'Santo Cristo','Santo Domingo','Talayan','Unang Sigaw','Veterans Village'
]) as barangay
on conflict (barangay) do update set
  zone=excluded.zone, fee=excluded.fee, estimated_time=excluded.estimated_time,
  is_active=true, updated_at=now();

insert into public.delivery_areas (barangay, zone, fee, estimated_time)
select barangay, 'Zone 3', 100, '40-60 mins'
from unnest(array[
  'Bagong Lipunan ng Crame','Bagumbayan','Bayanihan','Blue Ridge A','Blue Ridge B',
  'Botocan','Camp Aguinaldo','Central','East Kamias','Escopa I','Escopa II',
  'Escopa III','Escopa IV','Horseshoe','Kamuning','Kristong Hari','Krus na Ligas',
  'Laging Handa','Libis','Loyola Heights','Malaya','Mangga','Mariana',
  'Old Capitol Site','Paligsahan','Pinagkaisahan','Pinyahan','Quirino 2-A',
  'Quirino 2-B','Quirino 2-C','Quirino 3-A','Quirino 3-B','Roxas',
  'Sacred Heart','Saint Ignatius','Saint Peter','Santa Cruz','Santa Teresita',
  'Santo Nino','Santol','Sienna','Silangan','Socorro','South Triangle',
  'Tagumpay','Teachers Village East','Teachers Village West','Ugong Norte',
  'UP Campus','UP Village','Valencia','West Kamias','West Triangle','White Plains',
  'Kalusugan','New Era'
]) as barangay
on conflict (barangay) do update set
  zone=excluded.zone, fee=excluded.fee, estimated_time=excluded.estimated_time,
  is_active=true, updated_at=now();

alter table public.delivery_areas enable row level security;
drop policy if exists "Public reads active delivery areas" on public.delivery_areas;
create policy "Public reads active delivery areas" on public.delivery_areas
for select to anon, authenticated using (is_active = true);
grant select on public.delivery_areas to anon, authenticated;


-- 2. OTP storage and atomic rate limiting.
-- thecoffeerealm custom 6-digit customer signup OTP storage
-- Run this in Supabase SQL Editor before deploying the customer OTP Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.customer_email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  username text,
  purpose text not null default 'register' check (purpose in ('register')),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_email_otps_email_purpose_created_idx
  on public.customer_email_otps (lower(email), purpose, created_at desc);

alter table public.customer_email_otps enable row level security;

-- No public RLS policies are intentionally created.
-- These rows should only be read/written by Supabase Edge Functions using the service-role key.

create table if not exists public.customer_otp_rate_limits (
  scope text not null check (scope in ('email','ip','global')),
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (scope, key_hash)
);

alter table public.customer_otp_rate_limits enable row level security;

create or replace function public.consume_customer_otp_rate_limit(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if p_scope not in ('email','ip','global') or p_key_hash is null or p_key_hash = '' then
    raise exception 'Invalid OTP rate-limit key';
  end if;
  if p_window_seconds < 1 or p_max_requests < 1 then
    raise exception 'Invalid OTP rate-limit configuration';
  end if;

  insert into public.customer_otp_rate_limits as rate
    (scope, key_hash, window_started_at, request_count)
  values (p_scope, p_key_hash, now(), 1)
  on conflict (scope, key_hash) do update set
    window_started_at = case
      when rate.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else rate.window_started_at
    end,
    request_count = case
      when rate.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else rate.request_count + 1
    end
  returning request_count <= p_max_requests into allowed;

  return allowed;
end;
$$;

revoke all on function public.consume_customer_otp_rate_limit(text,text,integer,integer) from public;
grant execute on function public.consume_customer_otp_rate_limit(text,text,integer,integer) to service_role;

-- No public RLS policies are intentionally created for rate-limit counters.


-- 3. Customer order, payment, add-on, and proof validation.
-- Run this complete file in Supabase Dashboard > SQL Editor.
-- Prerequisite: the canonical menu_items catalog, cashier order tables, and
-- supabase/delivery_areas.sql.
create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists order_sequence bigint,
  add column if not exists order_source text;

create sequence if not exists public.orders_order_sequence_seq;
select setval(
  'public.orders_order_sequence_seq',
  greatest(coalesce((select max(order_sequence) from public.orders), 0) + 1, 1),
  false
);
alter table public.orders
  alter column order_sequence set default nextval('public.orders_order_sequence_seq'),
  alter column order_source set default 'customer_pos';

alter table public.orders
  drop constraint if exists orders_order_source_check;
alter table public.orders
  add constraint orders_order_source_check
  check (order_source is not null and btrim(order_source) <> '');

alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status is not null and btrim(status) <> '');

create or replace function public.ensure_order_insert_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_sequence is null then
    new.order_sequence := nextval('public.orders_order_sequence_seq');
  end if;
  if new.order_source is null or btrim(new.order_source) = '' then
    new.order_source := 'customer_pos';
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_order_insert_defaults_trigger on public.orders;
create trigger ensure_order_insert_defaults_trigger
before insert on public.orders
for each row execute function public.ensure_order_insert_defaults();

alter table public.orders
  add column if not exists customer_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_proof_path text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists delivery_address text,
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists schedule_date date,
  add column if not exists schedule_time time;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid, product_name text not null, name text not null,
  unit_price numeric(12,2) not null default 0, price numeric(12,2) not null default 0,
  quantity integer not null default 1, qty integer not null default 1,
  line_total numeric(12,2) not null default 0, addons jsonb not null default '[]'::jsonb,
  customizations jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  method text not null, amount_due numeric(12,2) not null default 0,
  reference_number text, status text not null default 'pending', paid_at timestamptz,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Customers upload their payment proofs" on storage.objects;
create policy "Customers upload their payment proofs" on storage.objects for insert to authenticated
with check (bucket_id='payment-proofs' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Customers view their payment proofs" on storage.objects;
create policy "Customers view their payment proofs" on storage.objects for select to authenticated
using (bucket_id='payment-proofs' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.create_customer_order(request_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  c jsonb:=coalesce(request_payload->'customer','{}'::jsonb); i jsonb; m public.menu_items%rowtype;
  oid uuid:=gen_random_uuid(); ono text:='CR-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  q integer; unit numeric(12,2); adds numeric(12,2); line numeric(12,2); sub numeric(12,2):=0;
  requested_addon_count integer; valid_addon_count integer; selected_temperature text;
  fee numeric(12,2):=0; grand numeric(12,2); pay text:=lower(btrim(coalesce(request_payload->>'payment_method','gcash')));
  fulfill text:=lower(btrim(coalesce(request_payload->>'fulfillment_method','delivery'))); order_status text;
  requested_barangay text:=btrim(coalesce(c->>'barangay',''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_array_length(coalesce(request_payload->'items','[]'::jsonb))=0 then raise exception 'The order has no items'; end if;
  if fulfill not in ('delivery','pickup') then raise exception 'Unsupported fulfillment method'; end if;
  if pay not in ('cod','gcash','bank_transfer') then raise exception 'Unsupported payment method'; end if;
  if pay='cod' and fulfill<>'delivery' then raise exception 'Cash on Delivery is available for delivery orders only'; end if;
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
    q:=greatest(1,coalesce((i->>'quantity')::integer,1)); unit:=m.price;
    selected_temperature:=lower(btrim(coalesce(i->>'temperature','')));
    if m.temperature_type='iced_only' and selected_temperature not in ('cold','iced') then raise exception 'This item requires a cold temperature'; end if;
    if m.temperature_type='hot_only' and selected_temperature<>'hot' then raise exception 'This item requires a hot temperature'; end if;
    if m.temperature_type='flexible' and selected_temperature not in ('hot','cold','iced') then raise exception 'Select a valid item temperature'; end if;
    if nullif(i->>'variation_id','') is not null and m.variant_options?'prices' and (m.variant_options->'prices')?(i->>'variation_id') then unit:=(m.variant_options->'prices'->>(i->>'variation_id'))::numeric; end if;
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
  insert into public.orders (id,order_number,order_source,order_type,status,customer_id,customer_name,customer_email,customer_phone,delivery_address,delivery_fee,schedule_date,schedule_time,subtotal,final_total,payment_status,payment_confirmed)
  values (oid,ono,'customer_pos',fulfill,order_status,auth.uid(),c->>'fullName',c->>'email',c->>'contact',case when fulfill='delivery' then concat_ws(', ',c->>'address','Brgy. '||(c->>'barangay'),c->>'city',c->>'province',c->>'postal') else null end,fee,nullif(c->>'scheduleDate','')::date,nullif(c->>'scheduleTime','')::time,sub,grand,'pending',false);
  insert into public.payments(order_id,method,amount_due,status) values(oid,pay,grand,'pending');
  for i in select * from jsonb_array_elements(request_payload->'items') loop
    select * into m from public.menu_items where id=(i->>'product_id')::uuid; q:=greatest(1,coalesce((i->>'quantity')::integer,1)); unit:=m.price;
    selected_temperature:=lower(btrim(coalesce(i->>'temperature','')));
    if nullif(i->>'variation_id','') is not null and m.variant_options?'prices' and (m.variant_options->'prices')?(i->>'variation_id') then unit:=(m.variant_options->'prices'->>(i->>'variation_id'))::numeric; end if;
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

drop function if exists public.set_customer_order_status(uuid,text);

revoke all on function public.create_customer_order(jsonb) from public;
revoke all on function public.attach_customer_payment_proof(uuid,text) from public;
grant execute on function public.create_customer_order(jsonb) to authenticated;
grant execute on function public.attach_customer_payment_proof(uuid,text) to authenticated;

-- Customer order privacy and internal operational access.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

drop policy if exists "cashier read orders" on public.orders;
drop policy if exists "cashier insert walkin orders" on public.orders;
drop policy if exists "Customers read only their orders" on public.orders;
drop policy if exists "Internal staff insert orders" on public.orders;
create policy "Customers read only their orders" on public.orders for select to authenticated
using (customer_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));
create policy "Internal staff insert orders" on public.orders for insert to authenticated
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));

drop policy if exists "cashier read order items" on public.order_items;
drop policy if exists "cashier insert order items" on public.order_items;
drop policy if exists "Customers read only their order items" on public.order_items;
drop policy if exists "Internal staff insert order items" on public.order_items;
create policy "Customers read only their order items" on public.order_items for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')))));
create policy "Internal staff insert order items" on public.order_items for insert to authenticated
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));

drop policy if exists "cashier read payments" on public.payments;
drop policy if exists "cashier insert payments" on public.payments;
drop policy if exists "Customers read only their payments" on public.payments;
drop policy if exists "Internal staff insert payments" on public.payments;
create policy "Customers read only their payments" on public.payments for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')))));
create policy "Internal staff insert payments" on public.payments for insert to authenticated
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));
notify pgrst,'reload schema';
