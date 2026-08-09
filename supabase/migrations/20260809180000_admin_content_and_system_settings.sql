-- Admin Content Management and System Settings
-- Stores validated configuration separately from menu, order, and account data.

create table if not exists public.portal_configuration (
  scope text not null check (scope in ('content', 'system')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  is_public boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);

create table if not exists public.site_testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  label text not null default 'Customer' check (char_length(label) <= 80),
  quote text not null check (char_length(trim(quote)) between 1 and 420),
  rating smallint not null default 5 check (rating between 1 and 5),
  visible boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.site_testimonials (id, name, label, quote, rating, visible, display_order)
values
  ('00000000-0000-4000-8000-000000000001', 'Mika S.', 'Customer', 'Their coffee and cheesecakes feel homemade in the best way. Cozy place, kind staff, and always worth coming back to.', 5, true, 0),
  ('00000000-0000-4000-8000-000000000002', 'Ari R.', 'Customer', 'The cookie boxes are my go-to gift. Every flavor tastes fresh and the packaging feels thoughtful.', 5, true, 1),
  ('00000000-0000-4000-8000-000000000003', 'Nico C.', 'Customer', 'Perfect North Fairview coffee stop. Good drinks, comforting meals, and a calm spot to work or meet friends.', 5, true, 2)
on conflict (id) do nothing;

create or replace function public.is_admin_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and lower(coalesce(role::text, '')) = 'admin'
  );
$$;

revoke all on function public.is_admin_profile() from public;
grant execute on function public.is_admin_profile() to anon, authenticated;

alter table public.portal_configuration enable row level security;
alter table public.site_testimonials enable row level security;

drop policy if exists "Public reads published portal configuration" on public.portal_configuration;
create policy "Public reads published portal configuration"
  on public.portal_configuration for select
  to anon, authenticated
  using (is_public or public.is_admin_profile());

drop policy if exists "Admins create portal configuration" on public.portal_configuration;
create policy "Admins create portal configuration"
  on public.portal_configuration for insert
  to authenticated
  with check (public.is_admin_profile() and updated_by = auth.uid());

drop policy if exists "Admins update portal configuration" on public.portal_configuration;
create policy "Admins update portal configuration"
  on public.portal_configuration for update
  to authenticated
  using (public.is_admin_profile())
  with check (public.is_admin_profile() and updated_by = auth.uid());

drop policy if exists "Admins delete portal configuration" on public.portal_configuration;
create policy "Admins delete portal configuration"
  on public.portal_configuration for delete
  to authenticated
  using (public.is_admin_profile());

drop policy if exists "Public reads visible testimonials" on public.site_testimonials;
create policy "Public reads visible testimonials"
  on public.site_testimonials for select
  to anon, authenticated
  using (visible or public.is_admin_profile());

drop policy if exists "Admins create testimonials" on public.site_testimonials;
create policy "Admins create testimonials"
  on public.site_testimonials for insert
  to authenticated
  with check (public.is_admin_profile());

drop policy if exists "Admins update testimonials" on public.site_testimonials;
create policy "Admins update testimonials"
  on public.site_testimonials for update
  to authenticated
  using (public.is_admin_profile())
  with check (public.is_admin_profile());

drop policy if exists "Admins delete testimonials" on public.site_testimonials;
create policy "Admins delete testimonials"
  on public.site_testimonials for delete
  to authenticated
  using (public.is_admin_profile());

-- Existing delivery rows stay public-read for checkout. Admins may maintain
-- fees, estimates, and active status from System Settings.
alter table public.delivery_areas enable row level security;
drop policy if exists "Admins manage delivery areas" on public.delivery_areas;
create policy "Admins manage delivery areas"
  on public.delivery_areas for all
  to authenticated
  using (public.is_admin_profile())
  with check (public.is_admin_profile());

grant select on public.portal_configuration, public.site_testimonials to anon, authenticated;
grant insert, update, delete on public.portal_configuration, public.site_testimonials to authenticated;
grant select, insert, update, delete on public.delivery_areas to authenticated;

-- Reuse the portal-wide immutable audit pipeline introduced by Users & Access.
-- The guard keeps this migration safe in projects whose migration ledger was
-- repaired separately; once the audit function exists, all three triggers are
-- installed automatically by rerunning this block.
do $$
begin
  if to_regprocedure('public.capture_portal_audit_event()') is not null then
    drop trigger if exists portal_audit_portal_configuration on public.portal_configuration;
    create trigger portal_audit_portal_configuration
      after insert or update or delete on public.portal_configuration
      for each row execute function public.capture_portal_audit_event('settings', 'key');

    drop trigger if exists portal_audit_site_testimonials on public.site_testimonials;
    create trigger portal_audit_site_testimonials
      after insert or update or delete on public.site_testimonials
      for each row execute function public.capture_portal_audit_event('content', 'name');

    drop trigger if exists portal_audit_delivery_areas on public.delivery_areas;
    create trigger portal_audit_delivery_areas
      after insert or update or delete on public.delivery_areas
      for each row execute function public.capture_portal_audit_event('settings', 'barangay');
  end if;
end $$;

comment on table public.portal_configuration is 'Versionable content and operational configuration for the management portal.';
comment on table public.site_testimonials is 'Customer-approved quotes displayed on public storefront surfaces.';
