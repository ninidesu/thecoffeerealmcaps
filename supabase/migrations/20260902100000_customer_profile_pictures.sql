-- Add customer profile pictures without exposing write access outside each user's folder.
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists avatar_path text;

-- Keep this migration usable on databases that have not yet installed the
-- broader customer-boundary migration.
create or replace function public.is_customer_profile() returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and regexp_replace(lower(btrim(coalesce(role, ''))), '[\s-]+', '_', 'g') = 'customer'
  );
$$;

revoke all on function public.is_customer_profile() from public;
grant execute on function public.is_customer_profile() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-pictures',
  'profile-pictures',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads profile pictures" on storage.objects;
create policy "Public reads profile pictures"
on storage.objects for select
using (bucket_id = 'profile-pictures');

drop policy if exists "Customers upload own profile pictures" on storage.objects;
create policy "Customers upload own profile pictures"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-pictures'
  and public.is_customer_profile()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Customers update own profile pictures" on storage.objects;
create policy "Customers update own profile pictures"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-pictures'
  and public.is_customer_profile()
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-pictures'
  and public.is_customer_profile()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Customers delete own profile pictures" on storage.objects;
create policy "Customers delete own profile pictures"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-pictures'
  and public.is_customer_profile()
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';
