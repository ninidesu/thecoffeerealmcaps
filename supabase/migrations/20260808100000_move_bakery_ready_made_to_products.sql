-- Ready-made bakery goods are sellable products, not recipe ingredients.
-- Preserve their stock details in finished_products, then archive the
-- ingredient records so they no longer appear in the Ingredients inventory.
with bakery_items as (
  select
    i.id,
    i.name,
    i.category,
    case lower(btrim(coalesce(i.unit, '')))
      when 'pc' then 'piece'
      when 'pcs' then 'piece'
      when 'pieces' then 'piece'
      when 'slices' then 'slice'
      when 'boxes' then 'box'
      else coalesce(nullif(btrim(i.unit), ''), 'piece')
    end as unit,
    coalesce(stock.quantity, 0) as quantity,
    coalesce(stock.min_stock_level, 0) as min_stock_level,
    coalesce(stock.high_stock_level, 0) as high_stock_level,
    i.supplier,
    i.notes
  from public.ingredients i
  left join public.inventory_stock stock on stock.ingredient_id = i.id
  where not i.is_archived
    and lower(btrim(coalesce(i.category, ''))) = 'bakery - ready made'
)
insert into public.finished_products (
  name, category, unit, quantity, min_stock_level, high_stock_level, supplier, notes
)
select name, category, unit, quantity, min_stock_level, high_stock_level, supplier, notes
from bakery_items
on conflict (lower(name), coalesce(category, '')) do update set
  unit = excluded.unit,
  quantity = excluded.quantity,
  min_stock_level = excluded.min_stock_level,
  high_stock_level = excluded.high_stock_level,
  supplier = excluded.supplier,
  notes = excluded.notes,
  is_archived = false,
  updated_at = now();

update public.ingredients
set is_archived = true
where not is_archived
  and lower(btrim(coalesce(category, ''))) = 'bakery - ready made';
