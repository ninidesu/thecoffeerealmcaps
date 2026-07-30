-- Fix "infinite recursion detected in policy for relation profiles".
--
-- The "Customers read own profile" policy added in
-- 20260729093000_auto_provision_customer_profiles.sql checked staff access
-- with a raw subquery against public.profiles from *inside* a policy on
-- public.profiles itself:
--
--   using (id = auth.uid() or exists(select 1 from public.profiles p ...))
--
-- Evaluating that subquery re-triggers the same RLS policy on profiles,
-- which evaluates the subquery again, forever. This is the standard,
-- well-known Postgres RLS trap; the standard fix is a SECURITY DEFINER
-- helper function, whose internal query runs as the function owner and so
-- does not re-trigger the caller's RLS policies on the same table.

create or replace function public.is_staff_profile() returns boolean
language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','cashier','staff','operational_staff')
  );
$$;

revoke all on function public.is_staff_profile() from public;
grant execute on function public.is_staff_profile() to authenticated;

drop policy if exists "Customers read own profile" on public.profiles;
create policy "Customers read own profile" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_staff_profile());

notify pgrst,'reload schema';
