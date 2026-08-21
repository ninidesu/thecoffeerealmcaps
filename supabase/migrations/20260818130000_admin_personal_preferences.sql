-- Extend the existing per-user management preferences to administrator accounts.
-- The table name is retained to avoid duplicating the established settings system.
drop policy if exists "Staff read own preferences" on public.staff_preferences;
drop policy if exists "Staff create own preferences" on public.staff_preferences;
drop policy if exists "Staff update own preferences" on public.staff_preferences;

create policy "Management users read own preferences"
on public.staff_preferences for select to authenticated
using (
  user_id = auth.uid()
  and (public.is_staff_profile() or public.is_admin_profile())
);

create policy "Management users create own preferences"
on public.staff_preferences for insert to authenticated
with check (
  user_id = auth.uid()
  and (public.is_staff_profile() or public.is_admin_profile())
);

create policy "Management users update own preferences"
on public.staff_preferences for update to authenticated
using (
  user_id = auth.uid()
  and (public.is_staff_profile() or public.is_admin_profile())
)
with check (
  user_id = auth.uid()
  and (public.is_staff_profile() or public.is_admin_profile())
);

notify pgrst, 'reload schema';
