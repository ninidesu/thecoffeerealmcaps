-- Keep every user-managed image bucket limited to safe static image formats.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-pictures', 'profile-pictures', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('portal-assets', 'portal-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
