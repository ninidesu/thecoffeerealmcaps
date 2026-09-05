-- Persist staff menu changes for administrator review.
create table if not exists public.menu_change_approvals (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id),
  action text not null check (action in ('add','change','remove')),
  item_name text not null,
  summary text not null,
  change_types text[] not null default '{}',
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists menu_change_approvals_state_created_idx
  on public.menu_change_approvals(state, created_at desc);

alter table public.menu_change_approvals enable row level security;
drop policy if exists "Admins read menu approvals" on public.menu_change_approvals;
create policy "Admins read menu approvals" on public.menu_change_approvals
  for select to authenticated using (public.is_admin_profile());

create or replace function public.staff_create_menu_approval(
  p_action text, p_item_name text, p_summary text, p_change_types text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public.normalize_role(role) in ('admin','staff','operational_staff') and removed_at is null) then
    raise exception 'Staff access required';
  end if;
  if p_action not in ('add','change','remove') or btrim(coalesce(p_item_name,'')) = '' then
    raise exception 'Invalid menu approval request';
  end if;
  insert into public.menu_change_approvals(submitted_by, action, item_name, summary, change_types)
  values (auth.uid(), p_action, left(btrim(p_item_name), 120), left(btrim(p_summary), 500), coalesce(p_change_types, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_decide_menu_approval(p_id uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_profile() then raise exception 'Administrator access required'; end if;
  if p_state not in ('approved','rejected') then raise exception 'Invalid approval decision'; end if;
  update public.menu_change_approvals set state = p_state, reviewed_by = auth.uid(), decided_at = now()
  where id = p_id and state = 'pending';
  if not found then raise exception 'Approval request not found or already decided'; end if;
end;
$$;

revoke all on function public.staff_create_menu_approval(text,text,text,text[]) from public;
revoke all on function public.admin_decide_menu_approval(uuid,text) from public;
grant execute on function public.staff_create_menu_approval(text,text,text,text[]) to authenticated;
grant execute on function public.admin_decide_menu_approval(uuid,text) to authenticated;
