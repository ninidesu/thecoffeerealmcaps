-- Restrict new submissions and resubmissions; preserve previously submitted IDs.
create or replace function public.submit_benefit_application(p_kind text, p_full_name text, p_date_of_birth date, p_id_number text, p_document_path text, p_consent boolean)
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
  if v_number is null or p_id_number !~ '^[0-9]{3,20}$' then raise exception 'Enter a valid ID number (3–20 digits only)'; end if;
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
