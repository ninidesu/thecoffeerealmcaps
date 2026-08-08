create unique index if not exists profiles_username_normalized_key
  on public.profiles (lower(btrim(username)))
  where nullif(btrim(username), '') is not null;

notify pgrst, 'reload schema';
