-- Address management hardening.
--
-- public.customer_addresses already has correct RLS ("customers manage own
-- addresses", using customer_id = auth.uid() via the existing non-recursive
-- current_profile_role() helper) — nothing to change there.
--
-- What was missing: nothing enforced "only one default address per
-- customer" at the database level, so the previous behavior depended
-- entirely on the frontend getting it right on every code path (add, edit,
-- delete) — which it didn't, since there was no address UI at all. This
-- migration makes the invariant a database guarantee instead, so it holds
-- no matter what the client does or how many requests race each other.

-- 1. Hard backstop: the database itself refuses to hold two default rows for
--    the same customer, even if every trigger below were somehow bypassed.
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses (customer_id)
  where is_default = true;

-- 2. Behavior guarantees, enforced BEFORE the row is written so the index
--    above is never violated within the same transaction:
--      - a customer's first address is always the default, regardless of
--        what the client sends;
--      - marking any address as default atomically un-defaults the
--        customer's other addresses first.
create or replace function public.customer_addresses_default_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not exists (
    select 1 from public.customer_addresses where customer_id = new.customer_id
  ) then
    new.is_default := true;
  end if;

  if new.is_default then
    update public.customer_addresses
    set is_default = false, updated_at = now()
    where customer_id = new.customer_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and is_default = true;
  end if;

  return new;
end;
$$;

drop trigger if exists customer_addresses_default_guard_trigger on public.customer_addresses;
create trigger customer_addresses_default_guard_trigger
before insert or update of is_default, customer_id on public.customer_addresses
for each row execute function public.customer_addresses_default_guard();

-- 3. Deleting the default address promotes the most recently added
--    remaining address to default automatically.
create or replace function public.customer_addresses_reassign_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_default then
    update public.customer_addresses
    set is_default = true, updated_at = now()
    where id = (
      select id from public.customer_addresses
      where customer_id = old.customer_id
      order by created_at desc
      limit 1
    );
  end if;
  return old;
end;
$$;

drop trigger if exists customer_addresses_reassign_default_trigger on public.customer_addresses;
create trigger customer_addresses_reassign_default_trigger
after delete on public.customer_addresses
for each row execute function public.customer_addresses_reassign_default();

-- 4. Safely correct any pre-existing duplicate defaults (data left over from
--    before these guards existed): keep the most recently updated default
--    per customer, unset the rest. A no-op if none exist.
with ranked as (
  select id, customer_id,
    row_number() over (partition by customer_id order by updated_at desc, created_at desc) as rn
  from public.customer_addresses
  where is_default = true
)
update public.customer_addresses a
set is_default = false, updated_at = now()
from ranked r
where a.id = r.id and r.rn > 1;

-- 5. Drop the temporary diagnostic function now that we've used it.
drop function if exists public.__diag_table(text);

notify pgrst,'reload schema';
