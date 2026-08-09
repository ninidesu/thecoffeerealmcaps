-- Enforce the customer/internal-account boundary at the database layer.
-- The browser intentionally has one Supabase session, but customer operations
-- must only accept profiles whose canonical role is customer.

create or replace function public.is_customer_profile() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and public.normalize_role(role) = 'customer'
      and removed_at is null
  );
$$;

revoke all on function public.is_customer_profile() from public;
grant execute on function public.is_customer_profile() to authenticated;

-- Public signup metadata is controlled by the caller. Internal roles must only
-- be assigned through the protected admin workflow.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    'customer'
  )
  on conflict do nothing;
  return new;
end;
$$;

-- Keep the established implementations intact and put a customer-role gate in
-- front of each SECURITY DEFINER customer RPC.
alter function public.create_customer_order(jsonb) rename to create_customer_order_internal;
revoke all on function public.create_customer_order_internal(jsonb) from public, anon, authenticated;

create function public.create_customer_order(request_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_customer_profile() then
    raise exception 'Customer account access required';
  end if;
  return public.create_customer_order_internal(request_payload);
end;
$$;

alter function public.attach_customer_payment_proof(uuid, text) rename to attach_customer_payment_proof_internal;
revoke all on function public.attach_customer_payment_proof_internal(uuid, text) from public, anon, authenticated;

create function public.attach_customer_payment_proof(p_order_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_customer_profile() then
    raise exception 'Customer account access required';
  end if;
  perform public.attach_customer_payment_proof_internal(p_order_id, p_path);
end;
$$;

alter function public.customer_cancel_order(uuid, text, text) rename to customer_cancel_order_internal;
revoke all on function public.customer_cancel_order_internal(uuid, text, text) from public, anon, authenticated;

create function public.customer_cancel_order(p_order_id uuid, p_reason text, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_customer_profile() then
    raise exception 'Customer account access required';
  end if;
  return public.customer_cancel_order_internal(p_order_id, p_reason, p_notes);
end;
$$;

revoke all on function public.create_customer_order(jsonb) from public;
revoke all on function public.attach_customer_payment_proof(uuid, text) from public;
revoke all on function public.customer_cancel_order(uuid, text, text) from public;
grant execute on function public.create_customer_order(jsonb) to authenticated;
grant execute on function public.attach_customer_payment_proof(uuid, text) to authenticated;
grant execute on function public.customer_cancel_order(uuid, text, text) to authenticated;

-- Staff retain operational read access, but only customer profiles can create
-- or manage customer-owned records.
alter table public.customer_addresses enable row level security;
drop policy if exists "customers manage own addresses" on public.customer_addresses;
drop policy if exists "Customers manage own addresses" on public.customer_addresses;
create policy "Customers manage own addresses" on public.customer_addresses
for all to authenticated
using (customer_id = auth.uid() and public.is_customer_profile())
with check (customer_id = auth.uid() and public.is_customer_profile());

drop policy if exists "Customers manage own feedback" on public.order_feedback;
create policy "Customers manage own feedback" on public.order_feedback
for all to authenticated
using (customer_id = auth.uid() and public.is_customer_profile())
with check (
  customer_id = auth.uid()
  and public.is_customer_profile()
  and exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.customer_id = auth.uid()
      and o.status = 'Completed'
  )
);

drop policy if exists "Internal staff read feedback" on public.order_feedback;
create policy "Internal staff read feedback" on public.order_feedback
for select to authenticated
using (public.is_staff_profile());

drop policy if exists "Customers read own cancellations" on public.order_cancellations;
create policy "Customers read own cancellations" on public.order_cancellations
for select to authenticated
using (
  (customer_id = auth.uid() and public.is_customer_profile())
  or public.is_staff_profile()
);

drop policy if exists "Customers upload their payment proofs" on storage.objects;
create policy "Customers upload their payment proofs" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and public.is_customer_profile()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Customers view their payment proofs" on storage.objects;
create policy "Customers view their payment proofs" on storage.objects
for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.is_customer_profile()
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';
