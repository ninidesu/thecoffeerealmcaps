alter table public.staff_preferences
  drop constraint if exists staff_preferences_font_size_check;

alter table public.staff_preferences
  add constraint staff_preferences_font_size_check
  check (font_size in ('standard', 'large', 'extra_large'));

notify pgrst, 'reload schema';
