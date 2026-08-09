-- Users & Access: role-based internal access and an immutable, portal-wide audit trail.

alter table public.profiles add column if not exists last_active_at timestamptz;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create or replace function public.normalize_role(p_role text) returns text
language sql immutable as $$
  select case
    when regexp_replace(lower(btrim(coalesce(p_role, ''))), '[\s-]+', '_', 'g') in ('operations_staff','operation_staff')
      then 'operational_staff'
    else regexp_replace(lower(btrim(coalesce(p_role, ''))), '[\s-]+', '_', 'g')
  end;
$$;

-- Preserve self-service profile editing without allowing users to re-role
-- themselves through a direct REST update. Service-role edge functions and
-- administrators remain authorized.
create or replace function public.prevent_profile_role_self_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and public.normalize_role(p.role) = 'admin'
  ) then
    if new.role is distinct from old.role then new.role := old.role; end if;
  end if;
  return new;
end;
$$;

create table if not exists public.portal_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name_snapshot text,
  actor_role_snapshot text,
  surface text not null default 'system' check (surface in ('admin', 'staff', 'cashier', 'system')),
  module text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text,
  summary text not null,
  result text not null default 'success' check (result in ('success', 'failed', 'warning')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid
);

create index if not exists portal_audit_events_occurred_at_idx on public.portal_audit_events (occurred_at desc);
create index if not exists portal_audit_events_actor_idx on public.portal_audit_events (actor_id, occurred_at desc);
create index if not exists portal_audit_events_module_idx on public.portal_audit_events (module, occurred_at desc);
create index if not exists portal_audit_events_surface_idx on public.portal_audit_events (surface, occurred_at desc);
create index if not exists portal_audit_events_entity_idx on public.portal_audit_events (entity_type, entity_id);

create or replace function public.is_admin_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and public.normalize_role(role) = 'admin'
  );
$$;

alter table public.portal_audit_events enable row level security;
drop policy if exists "Admins read portal audit events" on public.portal_audit_events;
create policy "Admins read portal audit events" on public.portal_audit_events
for select to authenticated using (public.is_admin_profile());

revoke insert, update, delete on public.portal_audit_events from anon, authenticated;

create or replace function public.audit_safe_json(p_value jsonb) returns jsonb
language sql immutable as $$
  select case when p_value is null then null else p_value - array[
    'password', 'password_hash', 'token', 'access_token', 'refresh_token', 'otp',
    'payment_proof_path', 'reset_token', 'secret', 'api_key'
  ] end;
$$;

create or replace function public.capture_portal_audit_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_role text;
  v_surface text := 'system';
  v_module text := coalesce(nullif(tg_argv[0], ''), tg_table_name);
  v_label_key text := coalesce(nullif(tg_argv[1], ''), 'name');
  v_label text;
  v_action text;
  v_severity text := 'info';
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_before := case when tg_op in ('UPDATE', 'DELETE') then public.audit_safe_json(to_jsonb(old)) else null end;
  v_after := case when tg_op in ('INSERT', 'UPDATE') then public.audit_safe_json(to_jsonb(new)) else null end;
  v_action := lower(tg_table_name || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end);
  v_label := coalesce(v_row ->> v_label_key, v_row ->> 'name', v_row ->> 'order_number', v_row ->> 'email', v_row ->> 'id', 'Record');
  v_actor_id := auth.uid();

  if v_actor_id is not null then
    select coalesce(full_name, username, email, 'Unknown user'), public.normalize_role(role)
    into v_actor_name, v_actor_role
    from public.profiles where id = v_actor_id;
    if not found then v_actor_id := null; end if;
  end if;

  v_surface := case
    when v_actor_role = 'admin' then 'admin'
    when v_actor_role = 'cashier' then 'cashier'
    when v_actor_role in ('staff', 'operational_staff') then 'staff'
    else 'system'
  end;
  if tg_table_name = 'profiles' and v_before ->> 'role' is distinct from v_after ->> 'role' then
    v_severity := 'critical';
  elsif tg_op = 'DELETE' then
    v_severity := 'warning';
  end if;

  insert into public.portal_audit_events (
    actor_id, actor_name_snapshot, actor_role_snapshot, surface, module, action,
    entity_type, entity_id, entity_label, summary, severity, before_data, after_data
  ) values (
    v_actor_id, v_actor_name, v_actor_role, v_surface, v_module, v_action,
    tg_table_name, v_row ->> 'id', v_label,
    concat(v_actor_name || ' ', case when v_actor_name is null then 'System ' else '' end,
      lower(case tg_op when 'INSERT' then 'created ' when 'UPDATE' then 'updated ' else 'deleted ' end), v_label),
    v_severity, v_before, v_after
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  item record;
begin
  for item in select * from (values
    ('profiles', 'users_access', 'full_name'),
    ('menu_items', 'menu', 'name'),
    ('ingredients', 'inventory', 'name'),
    ('inventory_stock', 'inventory', 'id'),
    ('finished_products', 'inventory', 'name'),
    ('supplies', 'inventory', 'name'),
    ('orders', 'orders', 'order_number'),
    ('payments', 'transactions', 'id'),
    ('refunds', 'refunds', 'id'),
    ('staff_preferences', 'settings', 'user_id')
  ) as configured(table_name, module_name, label_key)
  loop
    if to_regclass('public.' || item.table_name) is not null then
      execute format('drop trigger if exists portal_audit_%I on public.%I', item.table_name, item.table_name);
      execute format(
        'create trigger portal_audit_%I after insert or update or delete on public.%I for each row execute function public.capture_portal_audit_event(%L,%L)',
        item.table_name, item.table_name, item.module_name, item.label_key
      );
    end if;
  end loop;
end $$;

create or replace function public.admin_update_portal_user(
  p_user_id uuid,
  p_role text
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_current public.profiles%rowtype;
  v_role text := public.normalize_role(p_role);
  v_active_admins integer;
  v_result public.profiles%rowtype;
begin
  if not public.is_admin_profile() then raise exception 'Administrator access required'; end if;
  if v_role not in ('admin', 'staff', 'operational_staff', 'cashier') then raise exception 'Invalid portal role'; end if;

  select * into v_current from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User account not found'; end if;
  if p_user_id = auth.uid() and v_role <> 'admin' then
    raise exception 'You cannot remove your own administrator access';
  end if;

  if public.normalize_role(v_current.role) = 'admin' and v_role <> 'admin' then
    select count(*) into v_active_admins from public.profiles
    where id <> p_user_id and public.normalize_role(role) = 'admin';
    if v_active_admins = 0 then raise exception 'At least one administrator is required'; end if;
  end if;

  update public.profiles set
    role = v_role,
    updated_at = now()
  where id = p_user_id returning * into v_result;
  return v_result;
end;
$$;

drop function if exists public.admin_update_portal_user(uuid, text, text);
revoke all on function public.admin_update_portal_user(uuid, text) from public;
grant execute on function public.admin_update_portal_user(uuid, text) to authenticated;

-- Clean up the earlier lifecycle version if it was applied before this
-- role-only design was finalized.
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles drop column if exists invited_at;
alter table public.profiles drop column if exists suspended_at;
alter table public.profiles drop column if exists account_status;

do $$
begin
  if to_regclass('public.transaction_audit_log') is not null and to_regclass('public.orders') is not null then
    insert into public.portal_audit_events (
      occurred_at, actor_id, actor_name_snapshot, actor_role_snapshot, surface, module,
      action, entity_type, entity_id, entity_label, summary, severity, before_data, after_data, metadata
    )
    select
      t.created_at, t.performed_by, coalesce(p.full_name, p.username, p.email, 'Unknown user'), public.normalize_role(p.role),
      case when public.normalize_role(p.role) = 'cashier' then 'cashier' when public.normalize_role(p.role) = 'admin' then 'admin' else 'staff' end,
      'transactions', 'transaction.' || t.action, 'order', t.order_id::text, o.order_number,
      coalesce(p.full_name, p.username, p.email, 'Unknown user') || ' recorded ' || replace(t.action, '_', ' '),
      case when t.action in ('void', 'refund_rejected') then 'warning' else 'info' end,
      public.audit_safe_json(t.previous_value), public.audit_safe_json(t.new_value), jsonb_build_object('legacy_transaction_audit_id', t.id, 'reason', t.reason)
    from public.transaction_audit_log t
    left join public.profiles p on p.id = t.performed_by
    left join public.orders o on o.id = t.order_id
    where not exists (
      select 1 from public.portal_audit_events e where e.metadata ->> 'legacy_transaction_audit_id' = t.id::text
    );
  end if;
end $$;
