-- Canonical inventory units and order-driven stock movement.
-- Quantities are stored in base units: milliliter, gram, and piece.

create or replace function public.inventory_unit_factor(p_unit text) returns numeric
language sql immutable as $$
  select case lower(regexp_replace(coalesce(p_unit, ''), '[[:space:].]', '', 'g'))
    when 'l' then 1000 when 'liter' then 1000 when 'liters' then 1000
    when 'kg' then 1000 when 'kilogram' then 1000 when 'kilograms' then 1000
    else 1
  end;
$$;

create or replace function public.canonical_inventory_unit(p_unit text) returns text
language sql immutable as $$
  select case lower(regexp_replace(coalesce(p_unit, ''), '[[:space:].]', '', 'g'))
    when 'ml' then 'milliliter' when 'milliliter' then 'milliliter' when 'milliliters' then 'milliliter'
    when 'l' then 'milliliter' when 'liter' then 'milliliter' when 'liters' then 'milliliter'
    when 'g' then 'gram' when 'gram' then 'gram' when 'grams' then 'gram'
    when 'kg' then 'gram' when 'kilogram' then 'gram' when 'kilograms' then 'gram'
    when 'pc' then 'piece' when 'pcs' then 'piece' when 'piece' then 'piece' when 'pieces' then 'piece'
    when 'slice' then 'slice' when 'slices' then 'slice'
    when 'box' then 'box' when 'boxes' then 'box'
    when 'pack' then 'pack' when 'packs' then 'pack'
    when 'bag' then 'bag' when 'bags' then 'bag'
    when 'bottle' then 'bottle' when 'bottles' then 'bottle'
    when 'can' then 'can' when 'cans' then 'can'
    when 'cup' then 'cup' when 'cups' then 'cup'
    when 'jar' then 'jar' when 'jars' then 'jar'
    when 'tray' then 'tray' when 'trays' then 'tray'
    when 'tub' then 'tub' when 'tubs' then 'tub'
    when 'pouch' then 'pouch' when 'pouches' then 'pouch'
    when 'loaf' then 'loaf' when 'loaves' then 'loaf'
    when 'whole' then 'whole'
    else nullif(lower(btrim(p_unit)), '')
  end;
$$;

-- Existing recipe quantities were entered in the ingredient's previous unit.
-- Convert both the recipe and stock before replacing the stored unit label.
alter table public.menu_item_ingredients add column if not exists unit text;
with converted as (
  select recipe.ctid, public.inventory_unit_factor(ingredient.unit) as factor,
    public.canonical_inventory_unit(ingredient.unit) as unit
  from public.menu_item_ingredients recipe join public.ingredients ingredient on ingredient.id = recipe.ingredient_id
)
update public.menu_item_ingredients recipe
set quantity_per_serving = recipe.quantity_per_serving * converted.factor, unit = converted.unit
from converted where recipe.ctid = converted.ctid;

with converted as (select id, public.inventory_unit_factor(unit) as factor, public.canonical_inventory_unit(unit) as unit from public.ingredients)
update public.inventory_stock stock set quantity = stock.quantity * converted.factor, min_stock_level = stock.min_stock_level * converted.factor,
  high_stock_level = stock.high_stock_level * converted.factor, updated_at = now() from converted where stock.ingredient_id = converted.id;
with converted as (select id, public.canonical_inventory_unit(unit) as unit from public.ingredients)
update public.ingredients ingredient set unit = coalesce(converted.unit, ingredient.unit) from converted where ingredient.id = converted.id;

with converted as (select id, public.inventory_unit_factor(unit) as factor, public.canonical_inventory_unit(unit) as unit from public.finished_products)
update public.finished_products product set quantity = product.quantity * converted.factor, min_stock_level = product.min_stock_level * converted.factor,
  high_stock_level = product.high_stock_level * converted.factor, unit = coalesce(converted.unit, product.unit), updated_at = now() from converted where product.id = converted.id;
with converted as (select id, public.inventory_unit_factor(unit) as factor, public.canonical_inventory_unit(unit) as unit from public.supplies)
update public.supplies supply set quantity = supply.quantity * converted.factor, min_stock_level = supply.min_stock_level * converted.factor,
  high_stock_level = supply.high_stock_level * converted.factor, unit = coalesce(converted.unit, supply.unit), updated_at = now() from converted where supply.id = converted.id;

alter table public.finished_product_movements add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.finished_product_movements add column if not exists order_item_id uuid references public.order_items(id) on delete set null;
alter table public.finished_product_movements add column if not exists reversed boolean not null default false;

create table if not exists public.order_inventory_deductions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id),
  finished_product_id uuid references public.finished_products(id),
  quantity numeric not null check (quantity > 0),
  reversed boolean not null default false,
  created_at timestamptz not null default now(),
  check (num_nonnulls(ingredient_id, finished_product_id) = 1)
);
create unique index if not exists order_inventory_deductions_ingredient_unique on public.order_inventory_deductions(order_item_id, ingredient_id) where ingredient_id is not null;
create unique index if not exists order_inventory_deductions_product_unique on public.order_inventory_deductions(order_item_id, finished_product_id) where finished_product_id is not null;

create or replace function public.deduct_order_item_inventory(p_order_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item public.order_items%rowtype; v_order public.orders%rowtype; v_variant text;
  v_mapping record; v_recipe record; v_amount numeric; v_current numeric; v_has_product_mapping boolean;
begin
  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then raise exception 'Order item not found'; end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  if v_order.status = 'Cancelled' or coalesce(v_order.is_voided, false) then return; end if;
  if v_order.order_source = 'customer_pos' and not coalesce(v_order.payment_confirmed, false) then return; end if;
  if v_order.order_source = 'cashier_pos' and (v_order.receipt_number is null or not coalesce(v_order.payment_confirmed, false)) then return; end if;

  v_variant := nullif(coalesce(v_item.customizations->>'variation_id', v_item.customizations->>'variantKey', ''), '');
  select exists (
    select 1 from public.finished_product_sale_mappings mapping
    join public.finished_products product on product.id = mapping.finished_product_id and not product.is_archived
    where mapping.menu_item_id = v_item.menu_item_id
      and (mapping.variant_key is not distinct from v_variant
        or (mapping.variant_key is null and not exists (
          select 1 from public.finished_product_sale_mappings exact_mapping
          where exact_mapping.menu_item_id = v_item.menu_item_id and exact_mapping.variant_key is not distinct from v_variant
        )))
  ) into v_has_product_mapping;

  if v_has_product_mapping then
    for v_mapping in
      select mapping.* from public.finished_product_sale_mappings mapping
      join public.finished_products product on product.id = mapping.finished_product_id and not product.is_archived
      where mapping.menu_item_id = v_item.menu_item_id
        and (mapping.variant_key is not distinct from v_variant
          or (mapping.variant_key is null and not exists (
            select 1 from public.finished_product_sale_mappings exact_mapping
            where exact_mapping.menu_item_id = v_item.menu_item_id and exact_mapping.variant_key is not distinct from v_variant
          )))
    loop
      if exists (select 1 from public.order_inventory_deductions where order_item_id = v_item.id and finished_product_id = v_mapping.finished_product_id) then continue; end if;
      v_amount := v_mapping.units_per_sale * v_item.quantity;
      select quantity into v_current from public.finished_products where id = v_mapping.finished_product_id for update;
      if v_current < v_amount then raise exception 'Insufficient product stock for this order'; end if;
      update public.finished_products set quantity = quantity - v_amount, updated_at = now() where id = v_mapping.finished_product_id;
      insert into public.finished_product_movements (finished_product_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
        values (v_mapping.finished_product_id, v_order.id, v_item.id, 'deduction', v_amount, 'Order stock deduction', auth.uid());
      insert into public.order_inventory_deductions (order_id, order_item_id, finished_product_id, quantity)
        values (v_order.id, v_item.id, v_mapping.finished_product_id, v_amount);
    end loop;
  else
    for v_recipe in select ingredient_id, quantity_per_serving from public.menu_item_ingredients where menu_item_id = v_item.menu_item_id loop
      if exists (select 1 from public.order_inventory_deductions where order_item_id = v_item.id and ingredient_id = v_recipe.ingredient_id) then continue; end if;
      v_amount := v_recipe.quantity_per_serving * v_item.quantity;
      select quantity into v_current from public.inventory_stock where ingredient_id = v_recipe.ingredient_id for update;
      if v_current < v_amount then raise exception 'Insufficient ingredient stock for this order'; end if;
      update public.inventory_stock set quantity = quantity - v_amount, updated_at = now() where ingredient_id = v_recipe.ingredient_id;
      insert into public.inventory_movements (ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
        values (v_recipe.ingredient_id, v_order.id, v_item.id, 'deduction', v_amount, 'Order stock deduction', auth.uid());
      insert into public.order_inventory_deductions (order_id, order_item_id, ingredient_id, quantity)
        values (v_order.id, v_item.id, v_recipe.ingredient_id, v_amount);
    end loop;
  end if;
end;
$$;

create or replace function public.deduct_confirmed_online_order_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  if new.order_source = 'customer_pos' and not old.payment_confirmed and new.payment_confirmed then
    for v_item in select id from public.order_items where order_id = new.id loop perform public.deduct_order_item_inventory(v_item.id); end loop;
  end if;
  return new;
end;
$$;

create or replace function public.deduct_receipted_walk_in_item_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.deduct_order_item_inventory(new.id);
  return new;
end;
$$;

drop trigger if exists deduct_confirmed_online_order_inventory_trigger on public.orders;
create trigger deduct_confirmed_online_order_inventory_trigger after update of payment_confirmed on public.orders
  for each row execute function public.deduct_confirmed_online_order_inventory();
drop trigger if exists deduct_receipted_walk_in_item_inventory_trigger on public.order_items;
create trigger deduct_receipted_walk_in_item_inventory_trigger after insert on public.order_items
  for each row execute function public.deduct_receipted_walk_in_item_inventory();

create or replace function public.restore_order_inventory(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_deduction record;
begin
  for v_deduction in select * from public.order_inventory_deductions where order_id = p_order_id and not reversed for update loop
    if v_deduction.ingredient_id is not null then
      update public.inventory_stock set quantity = quantity + v_deduction.quantity, updated_at = now() where ingredient_id = v_deduction.ingredient_id;
      insert into public.inventory_movements (ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
        values (v_deduction.ingredient_id, p_order_id, v_deduction.order_item_id, 'restock', v_deduction.quantity, 'Order stock restored', auth.uid());
    else
      update public.finished_products set quantity = quantity + v_deduction.quantity, updated_at = now() where id = v_deduction.finished_product_id;
      insert into public.finished_product_movements (finished_product_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
        values (v_deduction.finished_product_id, p_order_id, v_deduction.order_item_id, 'restock', v_deduction.quantity, 'Order stock restored', auth.uid());
    end if;
    update public.order_inventory_deductions set reversed = true where id = v_deduction.id;
  end loop;
end;
$$;

create or replace function public.restore_reversed_order_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'Cancelled' and old.status is distinct from 'Cancelled')
    or (coalesce(new.is_voided, false) and not coalesce(old.is_voided, false))
    or (old.payment_confirmed and not new.payment_confirmed) then
    perform public.restore_order_inventory(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists restore_reversed_order_inventory_trigger on public.orders;
create trigger restore_reversed_order_inventory_trigger after update of status, is_voided, payment_confirmed on public.orders
  for each row execute function public.restore_reversed_order_inventory();

notify pgrst, 'reload schema';
