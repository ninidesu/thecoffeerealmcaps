-- Establish one store-wide pricing policy. Existing catalog and order amounts are
-- already VAT-inclusive, so this migration records the policy without repricing data.

insert into public.portal_configuration (scope, key, value, is_public)
values (
  'system',
  'pricing',
  jsonb_build_object(
    'vatRate', 0.12,
    'pricesIncludeVat', true,
    'currency', 'PHP',
    'version', 1
  ),
  true
)
on conflict (scope, key) do update
set value = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(coalesce(portal_configuration.value, '{}'::jsonb), '{vatRate}', '0.12'::jsonb),
                  '{pricesIncludeVat}', 'true'::jsonb
                ),
                '{currency}', '"PHP"'::jsonb
              ),
              '{version}', '1'::jsonb
            ),
    is_public = true,
    updated_at = now();

alter table public.orders
  add column if not exists vat_rate numeric(8, 6) not null default 0.12;

alter table public.orders
  add column if not exists prices_include_vat boolean not null default true;

alter table public.orders
  drop constraint if exists orders_vat_rate_valid;

alter table public.orders
  add constraint orders_vat_rate_valid check (vat_rate >= 0 and vat_rate <= 1);

comment on column public.orders.vat_rate is 'VAT rate captured from the global pricing policy when the order was created.';
comment on column public.orders.prices_include_vat is 'Whether the order prices included VAT when the order was created.';

create or replace function public.apply_global_pricing_policy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pricing_policy jsonb;
begin
  select value
    into pricing_policy
    from public.portal_configuration
   where scope = 'system'
     and key = 'pricing';

  new.vat_rate := coalesce((pricing_policy ->> 'vatRate')::numeric, 0.12);
  new.prices_include_vat := coalesce((pricing_policy ->> 'pricesIncludeVat')::boolean, true);

  if new.prices_include_vat is not true then
    raise exception 'The active pricing policy must keep menu prices VAT-inclusive';
  end if;

  return new;
end;
$$;

drop trigger if exists order_pricing_policy_snapshot on public.orders;

create trigger order_pricing_policy_snapshot
before insert on public.orders
for each row
execute function public.apply_global_pricing_policy_snapshot();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
         from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'portal_configuration'
     ) then
    alter publication supabase_realtime add table public.portal_configuration;
  end if;
end;
$$;

notify pgrst, 'reload schema';
