-- Retire active supply tracking without deleting historical supply records.
-- Existing supplies and movement records remain preserved for audit purposes,
-- but orders no longer read or deduct them.

begin;

-- A saved preference can no longer point at the retired inventory view.
update public.staff_preferences
set inventory_tab = 'ingredient'
where inventory_tab = 'supply';

alter table public.staff_preferences
  drop constraint if exists staff_preferences_inventory_tab_check;
alter table public.staff_preferences
  add constraint staff_preferences_inventory_tab_check
  check (inventory_tab in ('ingredient', 'finished_product'));

-- Staff completion now delegates to the canonical ingredient/product engine.
-- That engine is idempotent and only deducts paid online orders or receipted
-- walk-ins, so supplies are not consumed at any order state.
create or replace function public.deduct_order_ingredients(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'Completed' then
    raise exception 'Only completed orders deduct stock (order is %)', v_order.status;
  end if;

  for v_item in select id from public.order_items where order_id = p_order_id loop
    perform public.deduct_order_item_inventory(v_item.id);
  end loop;
end;
$$;

revoke all on function public.deduct_order_ingredients(uuid) from public;
revoke all on function public.deduct_order_ingredients(uuid) from anon;
revoke all on function public.deduct_order_ingredients(uuid) from authenticated;

-- Disconnect the product-to-supply mapping and its writer only after the
-- completion function has stopped reading it. Historical supply quantities
-- and movements intentionally remain untouched.
drop function if exists public.staff_set_menu_item_supplies(uuid, jsonb);
drop function if exists public.staff_upsert_supply(uuid, text, text, text, numeric, numeric, text, text, numeric);
drop function if exists public.staff_archive_supply(uuid);
drop table if exists public.menu_item_supplies;

-- Retain the shared adjustment endpoint for the two remaining inventory
-- types, but reject the retired supply type even if an old client calls it.
create or replace function public.staff_adjust_stock(
  p_item_type text, p_item_id uuid, p_delta numeric, p_movement_type text, p_reason text
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_current numeric;
  v_next numeric;
begin
  perform public.assert_inventory_writer();
  if p_item_type not in ('ingredient', 'finished_product') then raise exception 'Unsupported item type'; end if;
  if p_movement_type not in ('restock', 'deduction', 'adjustment', 'waste') then raise exception 'Unsupported movement type'; end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'Enter a non-zero amount'; end if;
  if v_reason = '' then raise exception 'A reason is required for every stock adjustment'; end if;
  if p_movement_type = 'restock' and p_delta < 0 then raise exception 'Restock amounts must be positive'; end if;
  if p_movement_type in ('deduction', 'waste') and p_delta > 0 then raise exception 'Deduction and waste amounts must be negative'; end if;

  if p_item_type = 'ingredient' then
    select quantity into v_current from public.inventory_stock where ingredient_id = p_item_id for update;
    if not found then raise exception 'Ingredient stock record not found'; end if;
    v_next := v_current + p_delta;
    if v_next < 0 then raise exception 'This would take stock below zero (currently %).', v_current; end if;
    update public.inventory_stock set quantity = v_next, updated_at = now() where ingredient_id = p_item_id;
    insert into public.inventory_movements (ingredient_id, movement_type, quantity, reason, created_by)
      values (p_item_id, p_movement_type, abs(p_delta), v_reason, auth.uid());
  else
    select quantity into v_current from public.finished_products where id = p_item_id for update;
    if not found then raise exception 'Finished product not found'; end if;
    v_next := v_current + p_delta;
    if v_next < 0 then raise exception 'This would take stock below zero (currently %).', v_current; end if;
    update public.finished_products set quantity = v_next, updated_at = now() where id = p_item_id;
    insert into public.finished_product_movements (finished_product_id, movement_type, quantity, reason, created_by)
      values (p_item_id, p_movement_type, abs(p_delta), v_reason, auth.uid());
  end if;

  return v_next;
end;
$$;

notify pgrst, 'reload schema';
commit;
