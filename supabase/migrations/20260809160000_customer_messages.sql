-- Unified customer message inbox for landing-page inquiries and Help requests.

create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('pre_order','general_inquiry','help_request')),
  source text not null check (source in ('landing','help')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  subject text not null,
  message text not null,
  inquiry_type text,
  preferred_date date,
  quantity text,
  status text not null default 'new' check (status in ('new','replied')),
  reply_text text,
  replied_at timestamptz,
  replied_by uuid references public.profiles(id) on delete set null,
  email_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_messages_created_idx on public.customer_messages(created_at desc);
create index if not exists customer_messages_category_status_idx on public.customer_messages(category,status,created_at desc);
alter table public.customer_messages enable row level security;

drop policy if exists "Staff can view customer messages" on public.customer_messages;
create policy "Staff can view customer messages" on public.customer_messages
  for select to authenticated using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and public.normalize_role(role) in ('admin','staff','operational_staff')
    )
  );

create or replace function public.submit_customer_message(
  p_category text,
  p_source text,
  p_name text,
  p_email text,
  p_phone text,
  p_subject text,
  p_message text,
  p_inquiry_type text default null,
  p_preferred_date date default null,
  p_quantity text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name,''));
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_subject text := btrim(coalesce(p_subject,''));
  v_message text := btrim(coalesce(p_message,''));
begin
  if p_category not in ('pre_order','general_inquiry','help_request') then raise exception 'Invalid message category'; end if;
  if p_source not in ('landing','help') then raise exception 'Invalid message source'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'Enter a valid name'; end if;
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' or length(v_email) > 254 then raise exception 'Enter a valid email address'; end if;
  if v_subject = '' or length(v_subject) > 180 then raise exception 'Enter a valid subject'; end if;
  if v_message = '' or length(v_message) > 5000 then raise exception 'Enter a message of up to 5,000 characters'; end if;
  if length(coalesce(p_phone,'')) > 40 or length(coalesce(p_inquiry_type,'')) > 80 or length(coalesce(p_quantity,'')) > 120 then raise exception 'One or more fields are too long'; end if;

  insert into public.customer_messages (
    customer_id, category, source, customer_name, customer_email, customer_phone,
    subject, message, inquiry_type, preferred_date, quantity
  ) values (
    auth.uid(), p_category, p_source, v_name, v_email, nullif(btrim(coalesce(p_phone,'')),''),
    v_subject, v_message, nullif(btrim(coalesce(p_inquiry_type,'')),''), p_preferred_date,
    nullif(btrim(coalesce(p_quantity,'')),'')
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_customer_message(text,text,text,text,text,text,text,text,date,text) from public;
grant execute on function public.submit_customer_message(text,text,text,text,text,text,text,text,date,text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customer_messages') then
    alter publication supabase_realtime add table public.customer_messages;
  end if;
end $$;
