-- Run this complete file in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

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
  fee numeric(12,2):=0; grand numeric(12,2); pay text:=coalesce(request_payload->>'payment_method','gcash');
  fulfill text:=coalesce(request_payload->>'fulfillment_method','delivery'); order_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_array_length(coalesce(request_payload->'items','[]'::jsonb))=0 then raise exception 'The order has no items'; end if;
  fee:=case when fulfill='delivery' then greatest(0,coalesce((c->>'deliveryFee')::numeric,0)) else 0 end;
  order_status:=case when pay='cod' then 'Preparing' else 'Pending Confirmation' end;
  for i in select * from jsonb_array_elements(request_payload->'items') loop
    select * into m from public.menu_items where id=(i->>'product_id')::uuid and is_available=true and is_archived=false;
    if not found then raise exception 'A selected menu item is unavailable'; end if;
    q:=greatest(1,coalesce((i->>'quantity')::integer,1)); unit:=m.price;
    if nullif(i->>'variation_id','') is not null and m.variant_options?'prices' and (m.variant_options->'prices')?(i->>'variation_id') then unit:=(m.variant_options->'prices'->>(i->>'variation_id'))::numeric; end if;
    select coalesce(sum(price),0) into adds from (
      select a.price from public.addons a where a.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) and a.is_available=true
      union all select x.price from public.menu_items x where x.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) and x.is_available=true and x.is_archived=false
    ) p;
    sub:=sub+((unit+adds)*q);
  end loop;
  grand:=sub+fee;
  insert into public.orders (id,order_number,order_source,order_type,status,customer_id,customer_name,customer_email,customer_phone,delivery_address,delivery_fee,schedule_date,schedule_time,subtotal,final_total,payment_status,payment_confirmed)
  values (oid,ono,'customer_pos',fulfill,order_status,auth.uid(),c->>'fullName',c->>'email',c->>'contact',case when fulfill='delivery' then concat_ws(', ',c->>'address','Brgy. '||(c->>'barangay'),c->>'city',c->>'province',c->>'postal') else null end,fee,nullif(c->>'scheduleDate','')::date,nullif(c->>'scheduleTime','')::time,sub,grand,'pending',false);
  insert into public.payments(order_id,method,amount_due,status) values(oid,pay,grand,'pending');
  for i in select * from jsonb_array_elements(request_payload->'items') loop
    select * into m from public.menu_items where id=(i->>'product_id')::uuid; q:=greatest(1,coalesce((i->>'quantity')::integer,1)); unit:=m.price;
    if nullif(i->>'variation_id','') is not null and m.variant_options?'prices' and (m.variant_options->'prices')?(i->>'variation_id') then unit:=(m.variant_options->'prices'->>(i->>'variation_id'))::numeric; end if;
    select coalesce(sum(price),0) into adds from (select a.price from public.addons a where a.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb))) union all select x.price from public.menu_items x where x.id::text in (select jsonb_array_elements_text(coalesce(i->'addon_ids','[]'::jsonb)))) p;
    line:=(unit+adds)*q;
    insert into public.order_items(order_id,product_id,product_name,name,unit_price,price,quantity,qty,line_total,addons,customizations)
    values(oid,m.id,m.name,m.name,unit,unit,q,q,line,coalesce(i->'addon_ids','[]'::jsonb),jsonb_build_object('variation_id',i->>'variation_id','special_instructions',i->>'special_instructions'));
  end loop;
  return jsonb_build_object('id',oid,'order_id',oid,'order_number',ono,'subtotal',sub,'delivery_fee',fee,'total',grand,'status',order_status);
end; $$;

create or replace function public.attach_customer_payment_proof(p_order_id uuid,p_path text) returns void
language plpgsql security definer set search_path=public as $$ begin
  update public.orders set payment_proof_path=p_path,payment_status='pending',payment_confirmed=false,status='Pending Confirmation',updated_at=now() where id=p_order_id and customer_id=auth.uid();
  if not found then raise exception 'Order not found or not owned by the signed-in customer'; end if;
end; $$;

create or replace function public.set_customer_order_status(p_order_id uuid,p_status text) returns void
language plpgsql security definer set search_path=public as $$ begin
  if p_status not in ('Preparing','Pending Confirmation') then raise exception 'Unsupported customer order status'; end if;
  update public.orders set status=p_status,updated_at=now() where id=p_order_id and customer_id=auth.uid();
  if not found then raise exception 'Order not found or not owned by the signed-in customer'; end if;
end; $$;

revoke all on function public.create_customer_order(jsonb) from public;
revoke all on function public.attach_customer_payment_proof(uuid,text) from public;
revoke all on function public.set_customer_order_status(uuid,text) from public;
grant execute on function public.create_customer_order(jsonb) to authenticated;
grant execute on function public.attach_customer_payment_proof(uuid,text) to authenticated;
grant execute on function public.set_customer_order_status(uuid,text) to authenticated;

-- Customer order privacy and internal operational access.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

drop policy if exists "cashier read orders" on public.orders;
drop policy if exists "cashier insert walkin orders" on public.orders;
drop policy if exists "Customers read only their orders" on public.orders;
create policy "Customers read only their orders" on public.orders for select to authenticated
using (customer_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));
create policy "Internal staff insert orders" on public.orders for insert to authenticated
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));

drop policy if exists "cashier read order items" on public.order_items;
drop policy if exists "cashier insert order items" on public.order_items;
drop policy if exists "Customers read only their order items" on public.order_items;
create policy "Customers read only their order items" on public.order_items for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')))));
create policy "Internal staff insert order items" on public.order_items for insert to authenticated
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));

drop policy if exists "cashier read payments" on public.payments;
drop policy if exists "cashier insert payments" on public.payments;
drop policy if exists "Customers read only their payments" on public.payments;
create policy "Customers read only their payments" on public.payments for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')))));
create policy "Internal staff insert payments" on public.payments for insert to authenticated
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','cashier','staff','operational_staff')));
notify pgrst,'reload schema';