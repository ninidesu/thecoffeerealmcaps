-- SUPPLY TRACKING — consume packaging and support items on order fulfilment.
--
-- Supplies stay a SEPARATE inventory type. Nothing here moves a supply into
-- public.ingredients: cups, lids, straws and boxes keep living in
-- public.supplies with their own history in public.supply_movements. What
-- this migration adds is the missing link between a sold product and the
-- packaging it consumes, plus the deduction pass that spends it.
--
-- Why a new table was unavoidable: menu_item_ingredients can only reference
-- public.ingredients (FK), and reusing it would have meant filing cups as
-- food ingredients — exactly what the brief forbids. public.menu_item_supplies
-- is the supply-side equivalent, and it carries two things the ingredient
-- mapping does not need:
--
--   applies_to_temperature  'hot' | 'iced' | null (=either)
--   applies_to_service      'dine_in' | 'takeout' | null (=either)
--
-- so one iced drink can take a cold cup + lid + straw while the same product
-- served hot takes a hot cup + lid + sleeve, and a food container is only
-- spent when the order actually leaves the shop.
--
-- menu_item_id is NULLABLE. A row with a null menu_item_id is an ORDER-LEVEL
-- supply: it is deducted once per qualifying order rather than once per item.
-- That is how a takeout bag works — one bag per bag-worthy order, not one bag
-- per dish.
--
-- DELIBERATELY NOT DONE: no trigger recomputes menu availability from supply
-- stock. Running out of straws must never pull drinks off the menu the way a
-- missing ingredient does. Supply shortages surface as warnings in Inventory
-- Management, and a short deduction records the shortfall in its reason,
-- but a sale is never blocked by packaging.

-- ---------------------------------------------------------------------
-- 1. Traceability columns on the existing supply history table.
--    Mirrors what inventory_movements already carries for ingredients so
--    both histories can be read the same way by the admin modules.
-- ---------------------------------------------------------------------
alter table public.supply_movements
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists order_item_id uuid references public.order_items(id) on delete set null,
  add column if not exists reversed boolean not null default false;

create index if not exists supply_movements_order_idx
  on public.supply_movements(order_id) where order_id is not null;

-- ---------------------------------------------------------------------
-- 2. The product <-> supply mapping.
-- ---------------------------------------------------------------------
create table if not exists public.menu_item_supplies (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  supply_id uuid not null references public.supplies(id) on delete cascade,
  quantity_per_serving numeric not null check (quantity_per_serving > 0),
  applies_to_temperature text check (applies_to_temperature in ('hot','iced')),
  applies_to_service text check (applies_to_service in ('dine_in','takeout')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per product+supply+condition combination. coalesce() is required
-- because NULL never equals NULL in a plain unique constraint, which would
-- let the same unconditional pair be inserted twice.
create unique index if not exists menu_item_supplies_uidx
  on public.menu_item_supplies (
    coalesce(menu_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    supply_id,
    coalesce(applies_to_temperature, ''),
    coalesce(applies_to_service, '')
  );

alter table public.menu_item_supplies enable row level security;
drop policy if exists "Staff read menu item supplies" on public.menu_item_supplies;
create policy "Staff read menu item supplies" on public.menu_item_supplies
  for select to authenticated using (public.is_staff_profile());

-- ---------------------------------------------------------------------
-- 3. Writer RPC — mirrors staff_set_menu_item_recipe.
--    Replaces the whole supply mapping for one product in a single call.
--    Pass p_menu_item_id = null to manage the order-level supplies.
-- ---------------------------------------------------------------------
create or replace function public.staff_set_menu_item_supplies(p_menu_item_id uuid, p_supplies jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_row jsonb;
begin
  perform public.assert_menu_writer();
  if p_menu_item_id is not null
     and not exists (select 1 from public.menu_items where id = p_menu_item_id) then
    raise exception 'Menu item not found';
  end if;

  if p_menu_item_id is null then
    delete from public.menu_item_supplies where menu_item_id is null;
  else
    delete from public.menu_item_supplies where menu_item_id = p_menu_item_id;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_supplies, '[]'::jsonb)) loop
    if coalesce((v_row->>'quantity_per_serving')::numeric, 0) <= 0 then
      raise exception 'Every supply line needs a quantity greater than zero';
    end if;
    insert into public.menu_item_supplies
      (menu_item_id, supply_id, quantity_per_serving, applies_to_temperature, applies_to_service, note)
    values (
      p_menu_item_id,
      (v_row->>'supply_id')::uuid,
      (v_row->>'quantity_per_serving')::numeric,
      nullif(v_row->>'applies_to_temperature', ''),
      nullif(v_row->>'applies_to_service', ''),
      nullif(v_row->>'note', '')
    );
  end loop;
end;
$$;

revoke all on function public.staff_set_menu_item_supplies(uuid,jsonb) from public;
revoke all on function public.staff_set_menu_item_supplies(uuid,jsonb) from anon;
grant execute on function public.staff_set_menu_item_supplies(uuid,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Deduction — ingredients (unchanged) plus supplies (new).
--    Still the same single entry point called by staff_advance_order_status
--    when an order becomes Completed, so there is one deduction moment.
--    Carries forward every guard added in
--    20260807100000_secure_deduct_order_ingredients.sql.
-- ---------------------------------------------------------------------
create or replace function public.deduct_order_ingredients(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_service text;
  v_line record;
  v_available numeric;
  v_deduct numeric;
  v_reason text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'Completed' then
    raise exception 'Only completed orders deduct stock (order is %)', v_order.status;
  end if;

  -- A walk-in is consumed in the shop; anything collected or delivered is
  -- packed to leave.
  v_service := case when v_order.order_type = 'walk-in' then 'dine_in' else 'takeout' end;

  -- =================================================================
  -- 4a. INGREDIENTS
  -- =================================================================
  if not exists (
    select 1 from public.inventory_movements
    where order_id = p_order_id and movement_type = 'deduction'
  ) then
    for v_line in
      select
        oi.id as order_item_id,
        coalesce(oi.display_name, oi.item_name) as product_name,
        oi.quantity as ordered_qty,
        mii.ingredient_id,
        i.unit as ingredient_unit,
        (mii.quantity_per_serving * oi.quantity) as required_qty
      from public.order_items oi
      join public.menu_item_ingredients mii on mii.menu_item_id = oi.menu_item_id
      join public.ingredients i on i.id = mii.ingredient_id
      where oi.order_id = p_order_id
        and oi.menu_item_id is not null
        and mii.quantity_per_serving > 0
      order by mii.ingredient_id
    loop
      select quantity into v_available
        from public.inventory_stock where ingredient_id = v_line.ingredient_id for update;
      if not found then continue; end if;

      v_deduct := least(v_line.required_qty, greatest(v_available, 0));
      v_reason := format('Order %s — %s x%s',
        coalesce(v_order.order_number, p_order_id::text), v_line.product_name, v_line.ordered_qty);
      if v_deduct < v_line.required_qty then
        v_reason := v_reason || format(' (short by %s %s — deducted available stock only)',
          v_line.required_qty - v_deduct, v_line.ingredient_unit);
      end if;

      if v_deduct > 0 then
        update public.inventory_stock
          set quantity = quantity - v_deduct, updated_at = now()
          where ingredient_id = v_line.ingredient_id;
        insert into public.inventory_movements
          (ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
        values
          (v_line.ingredient_id, p_order_id, v_line.order_item_id, 'deduction', v_deduct, v_reason, auth.uid());
      end if;
    end loop;
  end if;

  -- =================================================================
  -- 4b. SUPPLIES — separate guard so an order deducted before any supply
  --     mapping existed still picks its packaging up on a later call.
  -- =================================================================
  if exists (
    select 1 from public.supply_movements
    where order_id = p_order_id and movement_type = 'deduction'
  ) then
    return;
  end if;

  -- Per-item packaging. The temperature a line was actually sold at wins;
  -- if the order never recorded one, fall back to the product's own
  -- temperature_type, and finally assume iced for drinks, which is the
  -- default serve for most of this menu.
  for v_line in
    select
      oi.id as order_item_id,
      coalesce(oi.display_name, oi.item_name) as product_name,
      oi.quantity as ordered_qty,
      mis.supply_id,
      s.unit as supply_unit,
      (mis.quantity_per_serving * oi.quantity) as required_qty
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    join public.menu_item_supplies mis on mis.menu_item_id = oi.menu_item_id
    join public.supplies s on s.id = mis.supply_id
    where oi.order_id = p_order_id
      and oi.menu_item_id is not null
      and mis.quantity_per_serving > 0
      and not s.is_archived
      and (mis.applies_to_service is null or mis.applies_to_service = v_service)
      and (
        mis.applies_to_temperature is null
        or mis.applies_to_temperature = case
             when lower(coalesce(oi.customizations->>'temperature','')) like '%hot%' then 'hot'
             when lower(coalesce(oi.customizations->>'temperature','')) like '%cold%' then 'iced'
             when lower(coalesce(oi.customizations->>'temperature','')) like '%iced%' then 'iced'
             when mi.temperature_type = 'hot_only' then 'hot'
             when mi.temperature_type = 'iced_only' then 'iced'
             when mi.item_type = 'drink' then 'iced'
             else null
           end
      )
    order by mis.supply_id
  loop
    select quantity into v_available
      from public.supplies where id = v_line.supply_id for update;
    if not found then continue; end if;

    v_deduct := least(v_line.required_qty, greatest(v_available, 0));
    v_reason := format('Order %s — %s x%s (packaging)',
      coalesce(v_order.order_number, p_order_id::text), v_line.product_name, v_line.ordered_qty);
    if v_deduct < v_line.required_qty then
      v_reason := v_reason || format(' (short by %s %s)',
        v_line.required_qty - v_deduct, v_line.supply_unit);
    end if;

    if v_deduct > 0 then
      update public.supplies
        set quantity = quantity - v_deduct, updated_at = now()
        where id = v_line.supply_id;
      insert into public.supply_movements
        (supply_id, order_id, order_item_id, movement_type, quantity, reason, created_by)
      values
        (v_line.supply_id, p_order_id, v_line.order_item_id, 'deduction', v_deduct, v_reason, auth.uid());
    end if;
  end loop;

  -- Order-level packaging (menu_item_id is null): one takeout bag per order,
  -- not one per dish.
  for v_line in
    select mis.supply_id, s.unit as supply_unit, mis.quantity_per_serving as required_qty
    from public.menu_item_supplies mis
    join public.supplies s on s.id = mis.supply_id
    where mis.menu_item_id is null
      and mis.quantity_per_serving > 0
      and not s.is_archived
      and mis.applies_to_temperature is null
      and (mis.applies_to_service is null or mis.applies_to_service = v_service)
    order by mis.supply_id
  loop
    select quantity into v_available
      from public.supplies where id = v_line.supply_id for update;
    if not found then continue; end if;

    v_deduct := least(v_line.required_qty, greatest(v_available, 0));
    v_reason := format('Order %s — order packaging',
      coalesce(v_order.order_number, p_order_id::text));
    if v_deduct < v_line.required_qty then
      v_reason := v_reason || format(' (short by %s %s)',
        v_line.required_qty - v_deduct, v_line.supply_unit);
    end if;

    if v_deduct > 0 then
      update public.supplies
        set quantity = quantity - v_deduct, updated_at = now()
        where id = v_line.supply_id;
      insert into public.supply_movements
        (supply_id, order_id, movement_type, quantity, reason, created_by)
      values
        (v_line.supply_id, p_order_id, 'deduction', v_deduct, v_reason, auth.uid());
    end if;
  end loop;
end;
$$;

-- create or replace re-applies Supabase's default privileges, which grant
-- EXECUTE to anon and authenticated. Strip them again — see
-- 20260807100000_secure_deduct_order_ingredients.sql for why this matters.
revoke all on function public.deduct_order_ingredients(uuid) from public;
revoke all on function public.deduct_order_ingredients(uuid) from anon;
revoke all on function public.deduct_order_ingredients(uuid) from authenticated;

notify pgrst,'reload schema';
