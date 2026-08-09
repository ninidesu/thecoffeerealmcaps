-- Public payment QR assets managed by administrators.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-assets', 'portal-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads portal assets" on storage.objects;
create policy "Public reads portal assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'portal-assets');

drop policy if exists "Admins manage portal assets" on storage.objects;
create policy "Admins manage portal assets"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'portal-assets' and public.is_admin_profile())
  with check (bucket_id = 'portal-assets' and public.is_admin_profile());
