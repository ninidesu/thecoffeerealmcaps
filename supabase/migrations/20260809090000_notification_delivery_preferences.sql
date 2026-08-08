-- Split staff notification preferences into persistent bell alerts and temporary system popups.
-- This migration is safe for the existing database and does not recreate staff_preferences.
alter table public.staff_preferences
  add column if not exists system_change_popups boolean not null default true,
  add column if not exists system_error_popups boolean not null default true;

notify pgrst, 'reload schema';
