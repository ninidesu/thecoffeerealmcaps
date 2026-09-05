-- Keep public-facing customer inputs valid even when a caller bypasses the UI.

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
  v_phone text := nullif(btrim(coalesce(p_phone,'')), '');
  v_subject text := btrim(coalesce(p_subject,''));
  v_message text := btrim(coalesce(p_message,''));
  v_quantity text := nullif(btrim(coalesce(p_quantity,'')), '');
begin
  if p_category not in ('pre_order','general_inquiry','help_request') then raise exception 'Invalid message category'; end if;
  if p_source not in ('landing','help') then raise exception 'Invalid message source'; end if;
  if v_name !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then raise exception 'Enter a valid name'; end if;
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' or length(v_email) > 160 then raise exception 'Enter a valid email address'; end if;
  if v_phone is not null and v_phone !~ '^09[0-9]{9}$' then raise exception 'Contact number must contain 11 digits and start with 09'; end if;
  if v_subject = '' or length(v_subject) > 100 then raise exception 'Enter a valid subject'; end if;
  if v_message = '' or length(v_message) > 2000 then raise exception 'Enter a message of up to 2,000 characters'; end if;
  if length(coalesce(p_inquiry_type,'')) > 80 or length(coalesce(v_quantity,'')) > 60 then raise exception 'One or more fields are too long'; end if;

  insert into public.customer_messages (
    customer_id, category, source, customer_name, customer_email, customer_phone,
    subject, message, inquiry_type, preferred_date, quantity
  ) values (
    auth.uid(), p_category, p_source, v_name, v_email, v_phone,
    v_subject, v_message, nullif(btrim(coalesce(p_inquiry_type,'')),''), p_preferred_date,
    v_quantity
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_customer_message(text,text,text,text,text,text,text,text,date,text) from public;
grant execute on function public.submit_customer_message(text,text,text,text,text,text,text,text,date,text) to anon, authenticated;

create or replace function public.validate_profile_input() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.full_name is not null and btrim(new.full_name) !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then
    raise exception 'Full name must contain letters, spaces, periods, apostrophes, or hyphens and be 2 to 60 characters';
  end if;
  if new.username is not null and btrim(new.username) <> '' and btrim(new.username) !~ '^[A-Za-z0-9._-]{3,24}$' then
    raise exception 'Username must contain 3 to 24 letters, numbers, periods, underscores, or hyphens';
  end if;
  if new.phone is not null and btrim(new.phone) <> '' and btrim(new.phone) !~ '^09[0-9]{9}$' then
    raise exception 'Contact number must contain 11 digits and start with 09';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_profile_input_trigger on public.profiles;
create trigger validate_profile_input_trigger
before insert or update on public.profiles
for each row execute function public.validate_profile_input();

create or replace function public.validate_customer_address_input() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.label is not null and length(btrim(new.label)) > 40 then raise exception 'Address label must be 40 characters or fewer'; end if;
  if new.recipient_name is not null and btrim(new.recipient_name) <> '' and btrim(new.recipient_name) !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then raise exception 'Enter a valid recipient name'; end if;
  if new.phone is not null and btrim(new.phone) <> '' and btrim(new.phone) !~ '^09[0-9]{9}$' then raise exception 'Contact number must contain 11 digits and start with 09'; end if;
  if new.address_line is null or length(btrim(new.address_line)) = 0 or length(new.address_line) > 200 then raise exception 'Enter an address of up to 200 characters'; end if;
  if new.barangay is not null and length(btrim(new.barangay)) > 60 then raise exception 'Barangay must be 60 characters or fewer'; end if;
  if new.city is not null and length(btrim(new.city)) > 60 then raise exception 'City must be 60 characters or fewer'; end if;
  if new.province is not null and length(btrim(new.province)) > 60 then raise exception 'Province must be 60 characters or fewer'; end if;
  if new.postal_code is not null and btrim(new.postal_code) <> '' and btrim(new.postal_code) !~ '^[0-9]{4,6}$' then raise exception 'Postal code must contain 4 to 6 digits'; end if;
  if new.delivery_notes is not null and length(new.delivery_notes) > 300 then raise exception 'Delivery instructions must be 300 characters or fewer'; end if;
  return new;
end;
$$;

drop trigger if exists validate_customer_address_input_trigger on public.customer_addresses;
create trigger validate_customer_address_input_trigger
before insert or update on public.customer_addresses
for each row execute function public.validate_customer_address_input();
