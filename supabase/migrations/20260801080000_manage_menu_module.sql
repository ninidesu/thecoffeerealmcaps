-- Manage Menu module for Admin/Operations Staff.
--
-- menu_items / main_categories / subcategories / addons already exist (created
-- directly in the Supabase dashboard) and are the live catalog the customer
-- menu (menuService.js -> fetchMenuCatalog) reads from. This migration adds
-- the missing pieces so staff can manage them from the app instead of the
-- dashboard: additive columns, category archive/reorder support, a recipe
-- table link (menu_item_ingredients already exists), inventory-driven
-- availability that never clobbers the manual toggle, SECURITY DEFINER RPCs
-- for every write (matching the inventory module's pattern — no direct
-- INSERT/UPDATE/DELETE policies are added), and a menu-images storage bucket.

-- 1. menu_items: separate the staff-controlled toggle (manual_available) from
--    the computed customer-visible flag (is_available, unchanged column name
--    so fetchMenuCatalog() keeps working with no changes). unavailable_reason
--    is a cached explanation so the UI never has to re-derive it.
alter table public.menu_items
  add column if not exists manual_available boolean not null default true,
  add column if not exists is_featured boolean not null default false,
  add column if not exists is_bestseller boolean not null default false,
  add column if not exists prep_time_minutes integer check (prep_time_minutes is null or prep_time_minutes >= 0),
  add column if not exists available_from date,
  add column if not exists available_until date,
  add column if not exists unavailable_reason text,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill manual_available from whatever is_available already holds so
-- existing items don't flip state on migration.
update public.menu_items set manual_available = is_available where manual_available is distinct from is_available;

alter table public.menu_items
  drop constraint if exists menu_items_price_check;
alter table public.menu_items
  add constraint menu_items_price_check check (price >= 0);

-- Duplicate item names are only blocked within the same subcategory (a
-- "Latte" under Coffee and a "Latte" under Non-Coffee are distinct items).
create unique index if not exists menu_items_name_subcategory_uidx
  on public.menu_items (lower(name), coalesce(subcategory_id::text, ''));

-- 2. Category tables: bring both up to the same archive/reorder shape.
alter table public.main_categories
  add column if not exists is_archived boolean not null default false,
  add column if not exists sort_order integer not null default 0;
alter table public.subcategories
  add column if not exists is_archived boolean not null default false,
  add column if not exists sort_order integer not null default 0,
  add column if not exists main_category_id uuid references public.main_categories(id);

create unique index if not exists main_categories_name_uidx on public.main_categories (lower(name));
create unique index if not exists subcategories_name_scope_uidx on public.subcategories (lower(name), coalesce(main_category_id::text, ''));

-- 3. RLS: staff/admin read (customers already read menu_items/categories via
--    their own existing policies for the public menu — untouched here).
alter table public.main_categories enable row level security;
alter table public.subcategories enable row level security;
alter table public.menu_items enable row level security;
alter table public.addons enable row level security;

drop policy if exists "Staff read main categories" on public.main_categories;
create policy "Staff read main categories" on public.main_categories for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read subcategories" on public.subcategories;
create policy "Staff read subcategories" on public.subcategories for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read all menu items" on public.menu_items;
create policy "Staff read all menu items" on public.menu_items for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read all addons" on public.addons;
create policy "Staff read all addons" on public.addons for select to authenticated using (public.is_staff_profile());

-- 4. Availability engine. Computes is_available/unavailable_reason from:
--    archived > manual toggle > scheduled window > recipe ingredient stock.
--    Never writes manual_available — only the derived columns.
create or replace function public.recompute_menu_item_availability(p_menu_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item record;
  v_reason text;
  v_available boolean;
  v_missing boolean;
  v_insufficient boolean;
begin
  select id, is_archived, manual_available, available_from, available_until
    into v_item from public.menu_items where id = p_menu_item_id for update;
  if not found then return; end if;

  if v_item.is_archived then
    v_available := false; v_reason := 'archived';
  elsif not v_item.manual_available then
    v_available := false; v_reason := 'manual';
  elsif v_item.available_from is not null and current_date < v_item.available_from then
    v_available := false; v_reason := 'scheduled';
  elsif v_item.available_until is not null and current_date > v_item.available_until then
    v_available := false; v_reason := 'scheduled';
  else
    select
      bool_or(coalesce(s.quantity, 0) <= 0),
      bool_or(coalesce(s.quantity, 0) > 0 and coalesce(s.quantity, 0) < mii.quantity_per_serving)
      into v_missing, v_insufficient
    from public.menu_item_ingredients mii
    left join public.inventory_stock s on s.ingredient_id = mii.ingredient_id
    where mii.menu_item_id = p_menu_item_id;

    if coalesce(v_missing, false) then
      v_available := false; v_reason := 'missing_ingredient';
    elsif coalesce(v_insufficient, false) then
      v_available := false; v_reason := 'insufficient_stock';
    else
      v_available := true; v_reason := null;
    end if;
  end if;

  update public.menu_items set is_available = v_available, unavailable_reason = v_reason, updated_at = now()
    where id = p_menu_item_id;
end;
$$;

create or replace function public.trg_recompute_menu_items_from_ingredient() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_menu_item_id uuid;
begin
  for v_menu_item_id in select distinct menu_item_id from public.menu_item_ingredients where ingredient_id = new.ingredient_id loop
    perform public.recompute_menu_item_availability(v_menu_item_id);
  end loop;
  return new;
end;
$$;
drop trigger if exists recompute_menu_items_on_stock_change on public.inventory_stock;
create trigger recompute_menu_items_on_stock_change
  after insert or update of quantity on public.inventory_stock
  for each row execute function public.trg_recompute_menu_items_from_ingredient();

create or replace function public.trg_recompute_menu_item_from_recipe_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_menu_item_availability(coalesce(new.menu_item_id, old.menu_item_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists recompute_menu_item_on_recipe_change on public.menu_item_ingredients;
create trigger recompute_menu_item_on_recipe_change
  after insert or update or delete on public.menu_item_ingredients
  for each row execute function public.trg_recompute_menu_item_from_recipe_link();

-- 5. Writer guard (same roles as inventory: admin, staff, operational_staff).
create or replace function public.assert_menu_writer() returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff') then
    raise exception 'Menu management access required';
  end if;
end;
$$;

-- 6. Category RPCs.
create or replace function public.staff_upsert_main_category(p_id uuid, p_name text, p_display_name text, p_sort_order integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_menu_writer();
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Category name is required'; end if;
  begin
    if p_id is null then
      insert into public.main_categories (name, display_name, sort_order)
        values (btrim(p_name), nullif(btrim(coalesce(p_display_name,'')),''), coalesce(p_sort_order,0))
        returning id into v_id;
    else
      v_id := p_id;
      update public.main_categories set name = btrim(p_name), display_name = nullif(btrim(coalesce(p_display_name,'')),''), sort_order = coalesce(p_sort_order, sort_order)
        where id = v_id and not is_archived;
      if not found then raise exception 'Category not found'; end if;
    end if;
  exception when unique_violation then raise exception 'A category with this name already exists';
  end;
  return v_id;
end;
$$;

create or replace function public.staff_archive_main_category(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_menu_writer();
  if exists (select 1 from public.subcategories where main_category_id = p_id and not is_archived) then
    raise exception 'Cannot archive a category that still has active subcategories';
  end if;
  if exists (select 1 from public.menu_items where main_category_id = p_id and not is_archived) then
    raise exception 'Cannot archive a category that still has active menu items';
  end if;
  update public.main_categories set is_archived = true where id = p_id;
  if not found then raise exception 'Category not found'; end if;
end;
$$;

create or replace function public.staff_upsert_subcategory(p_id uuid, p_main_category_id uuid, p_name text, p_display_name text, p_sort_order integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_menu_writer();
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Subcategory name is required'; end if;
  begin
    if p_id is null then
      insert into public.subcategories (main_category_id, name, display_name, sort_order)
        values (p_main_category_id, btrim(p_name), nullif(btrim(coalesce(p_display_name,'')),''), coalesce(p_sort_order,0))
        returning id into v_id;
    else
      v_id := p_id;
      update public.subcategories set main_category_id = p_main_category_id, name = btrim(p_name), display_name = nullif(btrim(coalesce(p_display_name,'')),''), sort_order = coalesce(p_sort_order, sort_order)
        where id = v_id and not is_archived;
      if not found then raise exception 'Subcategory not found'; end if;
    end if;
  exception when unique_violation then raise exception 'A subcategory with this name already exists in this category';
  end;
  return v_id;
end;
$$;

create or replace function public.staff_archive_subcategory(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_menu_writer();
  if exists (select 1 from public.menu_items where subcategory_id = p_id and not is_archived) then
    raise exception 'Cannot archive a subcategory that still has active menu items';
  end if;
  update public.subcategories set is_archived = true where id = p_id;
  if not found then raise exception 'Subcategory not found'; end if;
end;
$$;

-- 7. Menu item upsert/archive/duplicate/availability RPCs.
create or replace function public.staff_upsert_menu_item(
  p_id uuid, p_main_category_id uuid, p_subcategory_id uuid, p_name text, p_slug text, p_description text,
  p_price numeric, p_item_type text, p_temperature_type text, p_allow_ice boolean, p_allow_sugar boolean,
  p_allow_addons boolean, p_image_url text, p_manual_available boolean, p_is_featured boolean, p_is_bestseller boolean,
  p_prep_time_minutes integer, p_available_from date, p_available_until date, p_sort_order integer, p_variant_options jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_slug text;
begin
  perform public.assert_menu_writer();
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Item name is required'; end if;
  if coalesce(p_price,-1) < 0 then raise exception 'Price cannot be negative'; end if;
  if p_available_from is not null and p_available_until is not null and p_available_from > p_available_until then
    raise exception 'Available-from date must be before the available-until date';
  end if;
  v_slug := nullif(btrim(coalesce(p_slug,'')), '');
  if v_slug is null then
    v_slug := lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
  end if;

  begin
    if p_id is null then
      insert into public.menu_items (
        main_category_id, subcategory_id, name, slug, description, price, item_type, temperature_type,
        allow_ice, allow_sugar, allow_addons, image_url, manual_available, is_available, is_featured, is_bestseller,
        prep_time_minutes, available_from, available_until, sort_order, variant_options, is_archived
      ) values (
        p_main_category_id, p_subcategory_id, btrim(p_name), v_slug, nullif(btrim(coalesce(p_description,'')),''), p_price,
        coalesce(p_item_type,'food'), coalesce(p_temperature_type,'none'), coalesce(p_allow_ice,false), coalesce(p_allow_sugar,false),
        coalesce(p_allow_addons,false), nullif(btrim(coalesce(p_image_url,'')),''), coalesce(p_manual_available,true), coalesce(p_manual_available,true),
        coalesce(p_is_featured,false), coalesce(p_is_bestseller,false), p_prep_time_minutes, p_available_from, p_available_until,
        coalesce(p_sort_order,0), coalesce(p_variant_options,'{}'::jsonb), false
      ) returning id into v_id;
    else
      v_id := p_id;
      update public.menu_items set
        main_category_id = p_main_category_id, subcategory_id = p_subcategory_id, name = btrim(p_name), slug = v_slug,
        description = nullif(btrim(coalesce(p_description,'')),''), price = p_price, item_type = coalesce(p_item_type,'food'),
        temperature_type = coalesce(p_temperature_type,'none'), allow_ice = coalesce(p_allow_ice,false), allow_sugar = coalesce(p_allow_sugar,false),
        allow_addons = coalesce(p_allow_addons,false), image_url = nullif(btrim(coalesce(p_image_url,'')),''),
        manual_available = coalesce(p_manual_available,true), is_featured = coalesce(p_is_featured,false), is_bestseller = coalesce(p_is_bestseller,false),
        prep_time_minutes = p_prep_time_minutes, available_from = p_available_from, available_until = p_available_until,
        sort_order = coalesce(p_sort_order, sort_order), variant_options = coalesce(p_variant_options, variant_options), updated_at = now()
        where id = v_id and not is_archived;
      if not found then raise exception 'Menu item not found'; end if;
    end if;
  exception when unique_violation then
    raise exception 'An item with this name already exists in this subcategory';
  end;

  perform public.recompute_menu_item_availability(v_id);
  return v_id;
end;
$$;

create or replace function public.staff_set_menu_item_availability(p_id uuid, p_manual_available boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_menu_writer();
  update public.menu_items set manual_available = p_manual_available, updated_at = now() where id = p_id and not is_archived;
  if not found then raise exception 'Menu item not found'; end if;
  perform public.recompute_menu_item_availability(p_id);
end;
$$;

create or replace function public.staff_archive_menu_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_menu_writer();
  update public.menu_items set is_archived = true, updated_at = now() where id = p_id;
  if not found then raise exception 'Menu item not found'; end if;
  perform public.recompute_menu_item_availability(p_id);
end;
$$;

create or replace function public.staff_duplicate_menu_item(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new_id uuid; v_src public.menu_items%rowtype; v_name text; v_slug text; v_suffix int := 1;
begin
  perform public.assert_menu_writer();
  select * into v_src from public.menu_items where id = p_id;
  if not found then raise exception 'Menu item not found'; end if;

  v_name := v_src.name || ' (Copy)';
  v_slug := v_src.slug || '-copy';
  while exists (select 1 from public.menu_items where lower(name) = lower(v_name) and coalesce(subcategory_id::text,'') = coalesce(v_src.subcategory_id::text,'')) loop
    v_suffix := v_suffix + 1;
    v_name := v_src.name || ' (Copy ' || v_suffix || ')';
    v_slug := v_src.slug || '-copy-' || v_suffix;
  end loop;

  insert into public.menu_items (
    main_category_id, subcategory_id, name, slug, description, price, item_type, temperature_type,
    allow_ice, allow_sugar, allow_addons, image_url, manual_available, is_available, is_featured, is_bestseller,
    prep_time_minutes, available_from, available_until, sort_order, variant_options, is_archived
  ) values (
    v_src.main_category_id, v_src.subcategory_id, v_name, v_slug, v_src.description, v_src.price, v_src.item_type, v_src.temperature_type,
    v_src.allow_ice, v_src.allow_sugar, v_src.allow_addons, v_src.image_url, false, false, v_src.is_featured, v_src.is_bestseller,
    v_src.prep_time_minutes, null, null, v_src.sort_order, v_src.variant_options, false
  ) returning id into v_new_id;

  insert into public.menu_item_ingredients (menu_item_id, ingredient_id, quantity_per_serving)
    select v_new_id, ingredient_id, quantity_per_serving from public.menu_item_ingredients where menu_item_id = p_id;

  perform public.recompute_menu_item_availability(v_new_id);
  return v_new_id;
end;
$$;

-- Replaces the full recipe (ingredient list) for a menu item in one call.
create or replace function public.staff_set_menu_item_recipe(p_menu_item_id uuid, p_ingredients jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_row jsonb;
begin
  perform public.assert_menu_writer();
  if not exists (select 1 from public.menu_items where id = p_menu_item_id) then raise exception 'Menu item not found'; end if;
  delete from public.menu_item_ingredients where menu_item_id = p_menu_item_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) loop
    insert into public.menu_item_ingredients (menu_item_id, ingredient_id, quantity_per_serving)
      values (p_menu_item_id, (v_row->>'ingredient_id')::uuid, (v_row->>'quantity_per_serving')::numeric);
  end loop;
  perform public.recompute_menu_item_availability(p_menu_item_id);
end;
$$;

revoke all on function public.staff_upsert_main_category(uuid,text,text,integer) from public;
revoke all on function public.staff_archive_main_category(uuid) from public;
revoke all on function public.staff_upsert_subcategory(uuid,uuid,text,text,integer) from public;
revoke all on function public.staff_archive_subcategory(uuid) from public;
revoke all on function public.staff_upsert_menu_item(uuid,uuid,uuid,text,text,text,numeric,text,text,boolean,boolean,boolean,text,boolean,boolean,boolean,integer,date,date,integer,jsonb) from public;
revoke all on function public.staff_set_menu_item_availability(uuid,boolean) from public;
revoke all on function public.staff_archive_menu_item(uuid) from public;
revoke all on function public.staff_duplicate_menu_item(uuid) from public;
revoke all on function public.staff_set_menu_item_recipe(uuid,jsonb) from public;
grant execute on function public.staff_upsert_main_category(uuid,text,text,integer) to authenticated;
grant execute on function public.staff_archive_main_category(uuid) to authenticated;
grant execute on function public.staff_upsert_subcategory(uuid,uuid,text,text,integer) to authenticated;
grant execute on function public.staff_archive_subcategory(uuid) to authenticated;
grant execute on function public.staff_upsert_menu_item(uuid,uuid,uuid,text,text,text,numeric,text,text,boolean,boolean,boolean,text,boolean,boolean,boolean,integer,date,date,integer,jsonb) to authenticated;
grant execute on function public.staff_set_menu_item_availability(uuid,boolean) to authenticated;
grant execute on function public.staff_archive_menu_item(uuid) to authenticated;
grant execute on function public.staff_duplicate_menu_item(uuid) to authenticated;
grant execute on function public.staff_set_menu_item_recipe(uuid,jsonb) to authenticated;

-- 8. Storage bucket for menu item photos. Public read (customer menu images),
--    staff-only write, matching the payment-proofs bucket's policy style.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('menu-images','menu-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Public read menu images" on storage.objects;
create policy "Public read menu images" on storage.objects for select
  using (bucket_id = 'menu-images');
drop policy if exists "Staff manage menu images" on storage.objects;
create policy "Staff manage menu images" on storage.objects for all to authenticated
  using (bucket_id = 'menu-images' and public.is_staff_profile())
  with check (bucket_id = 'menu-images' and public.is_staff_profile());

-- 9. Recompute every existing item once so the new columns are consistent
--    with today's actual inventory state.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.menu_items loop
    perform public.recompute_menu_item_availability(v_id);
  end loop;
end;
$$;

notify pgrst,'reload schema';
