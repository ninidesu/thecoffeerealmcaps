-- Private customer verification records. All mutations go through guarded RPCs.
create table public.benefit_applications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.profiles(id),
  kind text not null check (kind in ('senior','pwd')),
  full_name text not null check (char_length(full_name) between 2 and 60),
  date_of_birth date not null,
  id_number text not null check (char_length(id_number) between 3 and 40),
  document_path text not null,
  status text not null default 'pending' check (status in ('pending','resubmission','approved','rejected')),
  review_note text not null default '' check (char_length(review_note) <= 1000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  consent_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  revision integer not null default 1
);
create index benefit_applications_status_idx on public.benefit_applications(status, submitted_at desc);
create table public.benefit_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.benefit_applications(id),
  actor_id uuid not null references public.profiles(id),
  status text not null,
  note text not null default '',
  revision integer not null,
  created_at timestamptz not null default now()
);
alter table public.benefit_applications enable row level security;
alter table public.benefit_application_events enable row level security;
revoke all on public.benefit_applications, public.benefit_application_events from anon, authenticated;
grant select on public.benefit_applications, public.benefit_application_events to authenticated;
create policy "Owner or admin reads verification" on public.benefit_applications for select to authenticated
  using (customer_id = auth.uid() or public.is_admin_profile());
create policy "Owner or admin reads verification history" on public.benefit_application_events for select to authenticated
  using (exists (select 1 from public.benefit_applications a where a.id = application_id and (a.customer_id = auth.uid() or public.is_admin_profile())));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('benefit-documents','benefit-documents',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Private verification image read" on storage.objects for select to authenticated
  using (bucket_id = 'benefit-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin_profile()));
create policy "Customer uploads verification image" on storage.objects for insert to authenticated
  with check (bucket_id = 'benefit-documents' and public.is_customer_profile()
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (select 1 from public.benefit_applications where customer_id = auth.uid() and status <> 'resubmission'));
create policy "Customer removes unused verification upload" on storage.objects for delete to authenticated
  using (bucket_id = 'benefit-documents' and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (select 1 from public.benefit_applications where document_path = name));

create function public.submit_benefit_application(p_kind text, p_full_name text, p_date_of_birth date, p_id_number text, p_document_path text, p_consent boolean)
returns public.benefit_applications language plpgsql security definer set search_path = public as $$
declare v_row public.benefit_applications; v_name text := btrim(p_full_name); v_number text := btrim(p_id_number);
begin
  if not public.is_customer_profile() then raise exception 'Customer access required'; end if;
  -- Serialize first submissions and resubmissions for the same customer.
  perform 1 from public.profiles where id = auth.uid() for update;
  select * into v_row from public.benefit_applications where customer_id = auth.uid() for update;
  if found and v_row.status <> 'resubmission' then raise exception 'This application cannot be submitted again'; end if;
  if p_kind is null or p_kind not in ('senior','pwd') then raise exception 'Choose Senior Citizen or PWD'; end if;
  if v_name is null or char_length(v_name) not between 2 and 60 or v_name !~ '^[[:alpha:]][[:alpha:] .''-]*$' then raise exception 'Enter a valid full name (2–60 characters)'; end if;
  if p_date_of_birth is null or p_date_of_birth < date '1900-01-01' or p_date_of_birth > current_date then raise exception 'Enter a valid date of birth'; end if;
  if p_kind = 'senior' and p_date_of_birth > (current_date - interval '60 years')::date then raise exception 'Senior Citizen applicants must be at least 60 years old'; end if;
  if v_number is null or v_number !~ '^[A-Za-z0-9][A-Za-z0-9 /-]{2,39}$' then raise exception 'Enter a valid ID number (3–40 characters)'; end if;
  if p_consent is distinct from true then raise exception 'Confirm your information and consent before submitting'; end if;
  if p_document_path is null or split_part(p_document_path,'/',1) <> auth.uid()::text or not exists (
    select 1 from storage.objects where bucket_id = 'benefit-documents' and name = p_document_path
  ) then raise exception 'Upload a valid ID image belonging to your account'; end if;
  insert into public.benefit_applications(customer_id,kind,full_name,date_of_birth,id_number,document_path)
  values(auth.uid(),p_kind,v_name,p_date_of_birth,v_number,p_document_path)
  on conflict(customer_id) do update set kind=excluded.kind, full_name=excluded.full_name,
    date_of_birth=excluded.date_of_birth,id_number=excluded.id_number,document_path=excluded.document_path,
    status='pending',review_note='',reviewed_by=null,reviewed_at=null,submitted_at=now(),consent_at=now(),
    revision=benefit_applications.revision+1
  returning * into v_row;
  insert into public.benefit_application_events(application_id,actor_id,status,revision)
    values(v_row.id,auth.uid(),'pending',v_row.revision);
  return v_row;
end;
$$;
create function public.review_benefit_application(p_id uuid, p_revision integer, p_status text, p_note text)
returns public.benefit_applications language plpgsql security definer set search_path = public as $$
declare v_row public.benefit_applications; v_note text := btrim(coalesce(p_note,''));
begin
  if not public.is_admin_profile() then raise exception 'Administrator access required'; end if;
  if p_status is null or p_status not in ('approved','rejected','resubmission') then raise exception 'Choose a valid decision'; end if;
  if char_length(v_note)>1000 or (p_status <> 'approved' and char_length(v_note)<5) then raise exception 'Provide a reason (5–1,000 characters) for rejection or resubmission'; end if;
  update public.benefit_applications set status=p_status,review_note=v_note,reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_id and status='pending' and revision=p_revision returning * into v_row;
  if not found then raise exception 'Application changed or has already been reviewed. Refresh and try again'; end if;
  insert into public.benefit_application_events(application_id,actor_id,status,note,revision)
    values(v_row.id,auth.uid(),p_status,v_note,v_row.revision);
  return v_row;
end;
$$;
revoke all on function public.submit_benefit_application(text,text,date,text,text,boolean) from public;
revoke all on function public.review_benefit_application(uuid,integer,text,text) from public;
grant execute on function public.submit_benefit_application(text,text,date,text,text,boolean) to authenticated;
grant execute on function public.review_benefit_application(uuid,integer,text,text) to authenticated;
