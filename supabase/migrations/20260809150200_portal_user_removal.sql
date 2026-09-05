-- Preserve historical profile references while permanently removing portal sign-in.

alter table public.profiles add column if not exists removed_at timestamptz;
create index if not exists profiles_active_portal_role_idx
  on public.profiles (role) where removed_at is null;

create or replace function public.is_admin_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and public.normalize_role(role) = 'admin' and removed_at is null
  );
$$;

create or replace function public.prevent_profile_role_self_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if new.removed_at is distinct from old.removed_at then new.removed_at := old.removed_at; end if;
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and public.normalize_role(p.role) = 'admin' and p.removed_at is null
    ) and new.role is distinct from old.role then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.admin_update_portal_user(
  p_user_id uuid,
  p_role text
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_current public.profiles%rowtype;
  v_role text := public.normalize_role(p_role);
  v_other_admins integer;
  v_result public.profiles%rowtype;
begin
  if not public.is_admin_profile() then raise exception 'Administrator access required'; end if;
  if v_role not in ('admin', 'staff', 'operational_staff', 'cashier') then raise exception 'Invalid portal role'; end if;
  select * into v_current from public.profiles where id = p_user_id and removed_at is null for update;
  if not found then raise exception 'User account not found'; end if;
  if p_user_id = auth.uid() and v_role <> 'admin' then raise exception 'You cannot remove your own administrator access'; end if;
  if public.normalize_role(v_current.role) = 'admin' and v_role <> 'admin' then
    select count(*) into v_other_admins from public.profiles
    where id <> p_user_id and public.normalize_role(role) = 'admin' and removed_at is null;
    if v_other_admins = 0 then raise exception 'At least one administrator is required'; end if;
  end if;
  update public.profiles set role = v_role, updated_at = now()
  where id = p_user_id returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_update_portal_user(uuid, text) from public;
grant execute on function public.admin_update_portal_user(uuid, text) to authenticated;
