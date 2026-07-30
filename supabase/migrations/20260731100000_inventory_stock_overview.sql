-- Inventory Stock Overview for Operations Staff.
--
-- public.ingredients / inventory_stock / menu_item_ingredients /
-- inventory_movements / supplies already existed but were never wired to any
-- RLS policy, RPC, or UI — the "Inventory Management" page was 100%
-- hardcoded mock data (src/data/mockData.js). This migration adds the missing
-- pieces: a few additive columns, a new finished_products table (the one
-- entity type with no existing table), movement-history tables for the two
-- new item types, RLS restricted to staff/admin (customers get nothing), and
-- SECURITY DEFINER RPCs so every write is validated and audited — no client
-- can set stock directly or delete a row that's referenced elsewhere.

-- 1. Ingredients: add fields required by the UI. Existing rows default to
--    'other'/not archived so nothing already stored becomes invalid.
alter table public.ingredients
  add column if not exists type text not null default 'other' check (type in ('wet','dry','other')),
  add column if not exists supplier text,
  add column if not exists notes text,
  add column if not exists is_archived boolean not null default false;

-- Duplicate names were previously blocked globally; the requirement is
-- "duplicate names within the same category", which is a looser rule that
-- still prevents accidental duplicates while allowing the same name to exist
-- in two different categories.
alter table public.ingredients drop constraint if exists ingredients_name_key;
create unique index if not exists ingredients_name_category_uidx on public.ingredients (lower(name), coalesce(category, ''));

-- 2. Supplies: bring to parity with ingredients (a healthy-stock target for
--    the optional Over Stock state, and the same archive/supplier/notes
--    fields) using the same relaxed uniqueness rule.
alter table public.supplies
  add column if not exists high_stock_level numeric not null default 500 check (high_stock_level >= 0),
  add column if not exists supplier text,
  add column if not exists notes text,
  add column if not exists is_archived boolean not null default false;
alter table public.supplies drop constraint if exists supplies_name_key;
create unique index if not exists supplies_name_category_uidx on public.supplies (lower(name), coalesce(category, ''));

-- 3. Finished Products: the one entity type with no existing table.
--    Optionally linked to a menu_items row so its price/category can be
--    shown without duplicating that data.
create table if not exists public.finished_products (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  category text,
  unit text not null default 'unit',
  quantity numeric not null default 0 check (quantity >= 0),
  min_stock_level numeric not null default 10 check (min_stock_level >= 0),
  high_stock_level numeric not null default 100 check (high_stock_level >= 0),
  supplier text,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists finished_products_name_category_uidx on public.finished_products (lower(name), coalesce(category, ''));

-- 4. Movement history for the two item types that don't already have one
--    (inventory_movements already covers ingredients).
create table if not exists public.finished_product_movements (
  id uuid primary key default gen_random_uuid(),
  finished_product_id uuid not null references public.finished_products(id) on delete cascade,
  movement_type text not null check (movement_type in ('restock','deduction','adjustment','waste')),
  quantity numeric not null check (quantity > 0),
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.supply_movements (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete cascade,
  movement_type text not null check (movement_type in ('restock','deduction','adjustment','waste')),
  quantity numeric not null check (quantity > 0),
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 5. RLS: staff/admin/cashier can read (reuses the existing non-recursive
--    is_staff_profile() helper); customers get nothing, matching every other
--    internal-only table in this project. All writes go through the RPCs
--    below, so no INSERT/UPDATE/DELETE policy is needed on any of these
--    tables — consistent with how orders/payments are handled elsewhere.
alter table public.ingredients enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.menu_item_ingredients enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.supplies enable row level security;
alter table public.finished_products enable row level security;
alter table public.finished_product_movements enable row level security;
alter table public.supply_movements enable row level security;

drop policy if exists "Staff read ingredients" on public.ingredients;
create policy "Staff read ingredients" on public.ingredients for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read inventory stock" on public.inventory_stock;
create policy "Staff read inventory stock" on public.inventory_stock for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read recipe links" on public.menu_item_ingredients;
create policy "Staff read recipe links" on public.menu_item_ingredients for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read inventory movements" on public.inventory_movements;
create policy "Staff read inventory movements" on public.inventory_movements for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read supplies" on public.supplies;
create policy "Staff read supplies" on public.supplies for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read finished products" on public.finished_products;
create policy "Staff read finished products" on public.finished_products for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read finished product movements" on public.finished_product_movements;
create policy "Staff read finished product movements" on public.finished_product_movements for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read supply movements" on public.supply_movements;
create policy "Staff read supply movements" on public.supply_movements for select to authenticated using (public.is_staff_profile());

-- 6. Role guard shared by every RPC below. Admin has full access; Operations
--    Staff performs approved stock actions; cashier is read-only here
--    (matches the task: only Admin/Operations Staff perform inventory
--    actions, so cashier is deliberately excluded from the write checks even
--    though it can read via is_staff_profile() above).
create or replace function public.assert_inventory_writer() returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff') then
    raise exception 'Inventory management access required';
  end if;
end;
$$;

-- 7. Ingredients: create/update (metadata + thresholds only, never quantity
--    directly) and archive.
create or replace function public.staff_upsert_ingredient(
  p_id uuid, p_name text, p_category text, p_type text, p_unit text,
  p_min numeric, p_high numeric, p_supplier text, p_notes text, p_initial_quantity numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_inventory_writer();
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Ingredient name is required'; end if;
  if p_type not in ('wet','dry','other') then raise exception 'Invalid ingredient type'; end if;
  if coalesce(p_min,0) < 0 or coalesce(p_high,0) < 0 then raise exception 'Thresholds cannot be negative'; end if;
  if coalesce(p_high,0) > 0 and coalesce(p_min,0) > p_high then raise exception 'The low-stock threshold cannot exceed the healthy-stock target'; end if;

  begin
    if p_id is null then
      insert into public.ingredients (name, category, type, unit, supplier, notes)
        values (btrim(p_name), nullif(btrim(coalesce(p_category,'')),''), p_type, coalesce(nullif(btrim(p_unit),''),'unit'), nullif(btrim(coalesce(p_supplier,'')),''), nullif(btrim(coalesce(p_notes,'')),''))
        returning id into v_id;
      insert into public.inventory_stock (ingredient_id, quantity, min_stock_level, high_stock_level)
        values (v_id, greatest(coalesce(p_initial_quantity,0),0), coalesce(p_min,10), coalesce(p_high,500));
    else
      v_id := p_id;
      update public.ingredients set
        name = btrim(p_name), category = nullif(btrim(coalesce(p_category,'')),''), type = p_type,
        unit = coalesce(nullif(btrim(p_unit),''),'unit'), supplier = nullif(btrim(coalesce(p_supplier,'')),''),
        notes = nullif(btrim(coalesce(p_notes,'')),'')
        where id = v_id and not is_archived;
      if not found then raise exception 'Ingredient not found'; end if;
      update public.inventory_stock set min_stock_level = coalesce(p_min,min_stock_level), high_stock_level = coalesce(p_high,high_stock_level), updated_at = now()
        where ingredient_id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'An ingredient with this name already exists in this category';
  end;

  return v_id;
end;
$$;

create or replace function public.staff_archive_ingredient(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_inventory_writer();
  update public.ingredients set is_archived = true where id = p_id;
  if not found then raise exception 'Ingredient not found'; end if;
end;
$$;

-- 8. Finished products: same shape as ingredients, simpler (single table).
create or replace function public.staff_upsert_finished_product(
  p_id uuid, p_name text, p_category text, p_menu_item_id uuid, p_unit text,
  p_min numeric, p_high numeric, p_supplier text, p_notes text, p_initial_quantity numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_inventory_writer();
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Product name is required'; end if;
  if coalesce(p_min,0) < 0 or coalesce(p_high,0) < 0 then raise exception 'Thresholds cannot be negative'; end if;
  if coalesce(p_high,0) > 0 and coalesce(p_min,0) > p_high then raise exception 'The low-stock threshold cannot exceed the healthy-stock target'; end if;

  begin
    if p_id is null then
      insert into public.finished_products (name, category, menu_item_id, unit, quantity, min_stock_level, high_stock_level, supplier, notes)
        values (btrim(p_name), nullif(btrim(coalesce(p_category,'')),''), p_menu_item_id, coalesce(nullif(btrim(p_unit),''),'unit'), greatest(coalesce(p_initial_quantity,0),0), coalesce(p_min,10), coalesce(p_high,100), nullif(btrim(coalesce(p_supplier,'')),''), nullif(btrim(coalesce(p_notes,'')),''))
        returning id into v_id;
    else
      v_id := p_id;
      update public.finished_products set
        name = btrim(p_name), category = nullif(btrim(coalesce(p_category,'')),''), menu_item_id = p_menu_item_id,
        unit = coalesce(nullif(btrim(p_unit),''),'unit'), min_stock_level = coalesce(p_min,min_stock_level),
        high_stock_level = coalesce(p_high,high_stock_level), supplier = nullif(btrim(coalesce(p_supplier,'')),''),
        notes = nullif(btrim(coalesce(p_notes,'')),''), updated_at = now()
        where id = v_id and not is_archived;
      if not found then raise exception 'Finished product not found'; end if;
    end if;
  exception when unique_violation then
    raise exception 'A finished product with this name already exists in this category';
  end;

  return v_id;
end;
$$;

create or replace function public.staff_archive_finished_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_inventory_writer();
  update public.finished_products set is_archived = true, updated_at = now() where id = p_id;
  if not found then raise exception 'Finished product not found'; end if;
end;
$$;

-- 9. Supplies.
create or replace function public.staff_upsert_supply(
  p_id uuid, p_name text, p_category text, p_unit text,
  p_min numeric, p_high numeric, p_supplier text, p_notes text, p_initial_quantity numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_inventory_writer();
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Supply name is required'; end if;
  if coalesce(p_min,0) < 0 or coalesce(p_high,0) < 0 then raise exception 'Thresholds cannot be negative'; end if;
  if coalesce(p_high,0) > 0 and coalesce(p_min,0) > p_high then raise exception 'The low-stock threshold cannot exceed the healthy-stock target'; end if;

  begin
    if p_id is null then
      insert into public.supplies (name, category, unit, quantity, min_stock_level, high_stock_level, supplier, notes)
        values (btrim(p_name), nullif(btrim(coalesce(p_category,'')),''), coalesce(nullif(btrim(p_unit),''),'unit'), greatest(coalesce(p_initial_quantity,0),0), coalesce(p_min,10), coalesce(p_high,500), nullif(btrim(coalesce(p_supplier,'')),''), nullif(btrim(coalesce(p_notes,'')),''))
        returning id into v_id;
    else
      v_id := p_id;
      update public.supplies set
        name = btrim(p_name), category = nullif(btrim(coalesce(p_category,'')),''),
        unit = coalesce(nullif(btrim(p_unit),''),'unit'), min_stock_level = coalesce(p_min,min_stock_level),
        high_stock_level = coalesce(p_high,high_stock_level), supplier = nullif(btrim(coalesce(p_supplier,'')),''),
        notes = nullif(btrim(coalesce(p_notes,'')),''), updated_at = now()
        where id = v_id and not is_archived;
      if not found then raise exception 'Supply not found'; end if;
    end if;
  exception when unique_violation then
    raise exception 'A supply with this name already exists in this category';
  end;

  return v_id;
end;
$$;

create or replace function public.staff_archive_supply(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_inventory_writer();
  update public.supplies set is_archived = true, updated_at = now() where id = p_id;
  if not found then raise exception 'Supply not found'; end if;
end;
$$;

-- 10. Atomic, audited stock adjustment shared by all three item types. Row
--     is locked (for update) so two simultaneous adjustments can never both
--     read the same starting quantity, and a deduction that would take
--     stock below zero is always rejected — it never silently clamps to 0.
create or replace function public.staff_adjust_stock(
  p_item_type text, p_item_id uuid, p_delta numeric, p_movement_type text, p_reason text
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_current numeric;
  v_next numeric;
begin
  perform public.assert_inventory_writer();
  if p_item_type not in ('ingredient','finished_product','supply') then raise exception 'Unsupported item type'; end if;
  if p_movement_type not in ('restock','deduction','adjustment','waste') then raise exception 'Unsupported movement type'; end if;
  if coalesce(p_delta,0) = 0 then raise exception 'Enter a non-zero amount'; end if;
  if v_reason = '' then raise exception 'A reason is required for every stock adjustment'; end if;
  if p_movement_type = 'restock' and p_delta < 0 then raise exception 'Restock amounts must be positive'; end if;
  if p_movement_type in ('deduction','waste') and p_delta > 0 then raise exception 'Deduction and waste amounts must be negative'; end if;

  if p_item_type = 'ingredient' then
    select quantity into v_current from public.inventory_stock where ingredient_id = p_item_id for update;
    if not found then raise exception 'Ingredient stock record not found'; end if;
    v_next := v_current + p_delta;
    if v_next < 0 then raise exception 'This would take stock below zero (currently %).', v_current; end if;
    update public.inventory_stock set quantity = v_next, updated_at = now() where ingredient_id = p_item_id;
    insert into public.inventory_movements (ingredient_id, movement_type, quantity, reason, created_by)
      values (p_item_id, p_movement_type, abs(p_delta), v_reason, auth.uid());
  elsif p_item_type = 'finished_product' then
    select quantity into v_current from public.finished_products where id = p_item_id for update;
    if not found then raise exception 'Finished product not found'; end if;
    v_next := v_current + p_delta;
    if v_next < 0 then raise exception 'This would take stock below zero (currently %).', v_current; end if;
    update public.finished_products set quantity = v_next, updated_at = now() where id = p_item_id;
    insert into public.finished_product_movements (finished_product_id, movement_type, quantity, reason, created_by)
      values (p_item_id, p_movement_type, abs(p_delta), v_reason, auth.uid());
  else
    select quantity into v_current from public.supplies where id = p_item_id for update;
    if not found then raise exception 'Supply not found'; end if;
    v_next := v_current + p_delta;
    if v_next < 0 then raise exception 'This would take stock below zero (currently %).', v_current; end if;
    update public.supplies set quantity = v_next, updated_at = now() where id = p_item_id;
    insert into public.supply_movements (supply_id, movement_type, quantity, reason, created_by)
      values (p_item_id, p_movement_type, abs(p_delta), v_reason, auth.uid());
  end if;

  return v_next;
end;
$$;

revoke all on function public.staff_upsert_ingredient(uuid,text,text,text,text,numeric,numeric,text,text,numeric) from public;
revoke all on function public.staff_archive_ingredient(uuid) from public;
revoke all on function public.staff_upsert_finished_product(uuid,text,text,uuid,text,numeric,numeric,text,text,numeric) from public;
revoke all on function public.staff_archive_finished_product(uuid) from public;
revoke all on function public.staff_upsert_supply(uuid,text,text,text,numeric,numeric,text,text,numeric) from public;
revoke all on function public.staff_archive_supply(uuid) from public;
revoke all on function public.staff_adjust_stock(text,uuid,numeric,text,text) from public;
grant execute on function public.staff_upsert_ingredient(uuid,text,text,text,text,numeric,numeric,text,text,numeric) to authenticated;
grant execute on function public.staff_archive_ingredient(uuid) to authenticated;
grant execute on function public.staff_upsert_finished_product(uuid,text,text,uuid,text,numeric,numeric,text,text,numeric) to authenticated;
grant execute on function public.staff_archive_finished_product(uuid) to authenticated;
grant execute on function public.staff_upsert_supply(uuid,text,text,text,numeric,numeric,text,text,numeric) to authenticated;
grant execute on function public.staff_archive_supply(uuid) to authenticated;
grant execute on function public.staff_adjust_stock(text,uuid,numeric,text,text) to authenticated;

-- 11. Drop the temporary schema-introspection helpers now that we've used
--     them (the live schema was pasted directly instead, but these should
--     not linger in a production database).
drop function if exists public.__diag_tables();
drop function if exists public.__diag_table(text);

notify pgrst,'reload schema';
