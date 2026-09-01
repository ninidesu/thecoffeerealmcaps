-- Short, human-readable identifiers shared by cashier and customer orders.
-- The UUID in orders.id remains the immutable internal identifier used by
-- tracking links, payment proofs, and relationships.

create sequence if not exists public.short_walk_in_order_seq;
create sequence if not exists public.short_customer_order_seq;
create sequence if not exists public.short_reference_seq;

alter table public.orders
  add column if not exists receipt_number text;

create or replace function public.next_short_order_number(
  p_prefix text,
  p_created_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence bigint;
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
begin
  if v_prefix = 'WI' then
    v_sequence := nextval('public.short_walk_in_order_seq');
  elsif v_prefix = 'CR' then
    v_sequence := nextval('public.short_customer_order_seq');
  else
    raise exception 'Unsupported short order prefix';
  end if;

  return v_prefix || '-' ||
    to_char(coalesce(p_created_at, clock_timestamp()) at time zone 'Asia/Manila', 'MMDD') || '-' ||
    lpad(v_sequence::text, 4, '0');
end;
$$;

create or replace function public.next_short_reference_number(
  p_created_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence bigint;
begin
  v_sequence := nextval('public.short_reference_seq');
  return 'R-' ||
    to_char(coalesce(p_created_at, clock_timestamp()) at time zone 'Asia/Manila', 'MMDD') || '-' ||
    lpad(v_sequence::text, 4, '0');
end;
$$;

revoke all on function public.next_short_order_number(text, timestamptz) from public, anon, authenticated;
revoke all on function public.next_short_reference_number(timestamptz) from public, anon, authenticated;
revoke all on sequence public.short_walk_in_order_seq from public, anon, authenticated;
revoke all on sequence public.short_customer_order_seq from public, anon, authenticated;
revoke all on sequence public.short_reference_seq from public, anon, authenticated;

-- Every insert gets a server-generated canonical order ID. Cashier walk-ins
-- use WI; customer pickup and delivery orders use CR.
create or replace function public.assign_short_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  v_prefix := case
    when coalesce(new.order_source, '') = 'cashier_pos'
      or lower(btrim(coalesce(new.order_type, ''))) in ('walk-in', 'walk in', 'walkin')
      then 'WI'
    else 'CR'
  end;

  new.order_number := public.next_short_order_number(v_prefix, new.created_at);
  return new;
end;
$$;

drop trigger if exists zzz_assign_short_order_number_trigger on public.orders;
create trigger zzz_assign_short_order_number_trigger
  before insert on public.orders
  for each row execute function public.assign_short_order_number();

-- Replace the old long receipt format while keeping the existing trigger name
-- and unique constraint used by transaction history and reports.
create or replace function public.assign_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.receipt_number := public.next_short_reference_number(new.created_at);
  return new;
end;
$$;

drop trigger if exists assign_receipt_number_trigger on public.orders;
create trigger assign_receipt_number_trigger
  before insert on public.orders
  for each row execute function public.assign_receipt_number();

-- Keep the unique fields safe while replacing historical values, then assign
-- deterministic short values in creation order. This changes only display
-- identifiers; orders.id and all related records remain unchanged.
do $$
declare
  v_order record;
  v_prefix text;
begin
  update public.orders
  set order_number = 'MIGRATING-ORDER-' || id::text;

  update public.orders
  set receipt_number = 'MIGRATING-RECEIPT-' || id::text;

  for v_order in
    select id, order_source, order_type, created_at
    from public.orders
    order by created_at nulls first, id
  loop
    v_prefix := case
      when coalesce(v_order.order_source, '') = 'cashier_pos'
        or lower(btrim(coalesce(v_order.order_type, ''))) in ('walk-in', 'walk in', 'walkin')
        then 'WI'
      else 'CR'
    end;

    update public.orders
    set order_number = public.next_short_order_number(v_prefix, v_order.created_at)
    where id = v_order.id;

    update public.orders
    set receipt_number = public.next_short_reference_number(v_order.created_at)
    where id = v_order.id;
  end loop;
end;
$$;

-- Add the canonical identifiers to future cancellation/refund email payloads
-- without changing the existing queue workflow.
create or replace function public.sync_order_email_identifiers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_number text;
  v_receipt_number text;
begin
  select order_number, receipt_number
    into v_order_number, v_receipt_number
  from public.orders
  where id = new.order_id;

  if v_order_number is not null then
    new.payload := jsonb_set(
      coalesce(new.payload, '{}'::jsonb),
      '{order_number}',
      to_jsonb(v_order_number),
      true
    );
  end if;

  if v_receipt_number is not null then
    new.payload := jsonb_set(
      jsonb_set(
        new.payload,
        '{reference_code}',
        to_jsonb(v_receipt_number),
        true
      ),
      '{receipt_number}',
      to_jsonb(v_receipt_number),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_order_email_identifiers_trigger on public.order_email_outbox;
create trigger sync_order_email_identifiers_trigger
  before insert on public.order_email_outbox
  for each row execute function public.sync_order_email_identifiers();

update public.order_email_outbox email
set payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      coalesce(email.payload, '{}'::jsonb),
      '{order_number}',
      to_jsonb(orders.order_number),
      true
    ),
    '{reference_code}',
    to_jsonb(orders.receipt_number),
    true
  ),
  '{receipt_number}',
  to_jsonb(orders.receipt_number),
  true
),
updated_at = now()
from public.orders
where email.order_id = orders.id
  and email.status = 'pending';

-- Return server-generated identifiers from cashier checkout, including when
-- the client supplied a temporary/local draft number.
alter function public.create_cashier_order(jsonb) rename to create_cashier_order_internal;
revoke all on function public.create_cashier_order_internal(jsonb) from public, anon, authenticated;

create or replace function public.create_cashier_order(request_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_order public.orders%rowtype;
begin
  v_result := public.create_cashier_order_internal(request_payload);
  v_order_id := nullif(v_result ->> 'id', '')::uuid;

  if v_order_id is null then
    return v_result;
  end if;

  select * into v_order
  from public.orders
  where id = v_order_id;

  if not found then
    return v_result;
  end if;

  return v_result || jsonb_build_object(
    'order_number', v_order.order_number,
    'receipt_number', v_order.receipt_number
  );
end;
$$;

revoke all on function public.create_cashier_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_cashier_order(jsonb) to authenticated;

-- Do the same for customer checkout while preserving its existing role gate
-- and idempotency behavior in create_customer_order_internal.
create or replace function public.create_customer_order(request_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_order public.orders%rowtype;
begin
  if not public.is_customer_profile() then
    raise exception 'Customer account access required';
  end if;

  v_result := public.create_customer_order_internal(request_payload);
  v_order_id := nullif(v_result ->> 'id', '')::uuid;

  if v_order_id is null then
    return v_result;
  end if;

  select * into v_order
  from public.orders
  where id = v_order_id;

  if not found then
    return v_result;
  end if;

  return v_result || jsonb_build_object(
    'order_number', v_order.order_number,
    'receipt_number', v_order.receipt_number
  );
end;
$$;

revoke all on function public.create_customer_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_customer_order(jsonb) to authenticated;

notify pgrst, 'reload schema';
