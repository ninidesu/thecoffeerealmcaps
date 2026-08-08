-- =====================================================================
-- SUPPLY SEED — thecoffeerealm
-- =====================================================================
-- Records the non-food operational supplies (cups, lids, straws, sleeves,
-- containers, bags, boxes, napkins) and maps them to the products that
-- consume them, so packaging is spent automatically when an order is
-- completed.
--
-- REQUIRES 20260807110000_supply_tracking.sql to be applied first.
--
-- DATA ONLY beyond that migration. Writes to public.supplies and
-- public.menu_item_supplies. Supplies stay their own inventory type —
-- nothing here touches public.ingredients except the one correction in
-- STEP 4, which is explained there.
--
-- Idempotent: a supply is created only when no supply of that name exists,
-- and a mapping only when that exact product+supply+condition combination
-- does not already exist. Existing stock levels are never overwritten.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. The
-- "destructive operations" warning refers to the temp-table drops and the
-- single documented DELETE in STEP 4 — choose "Run without RLS".
-- =====================================================================

begin;

drop table if exists tmp_supply;
drop table if exists tmp_supply_map;
drop table if exists tmp_supply_plan;

-- ---------------------------------------------------------------------
-- STEP 1 — SUPPLY MASTER
-- ---------------------------------------------------------------------
-- Everything countable is tracked in 'piece' so a mapping quantity is
-- always literally "how many of these are used".
create temp table tmp_supply (name text primary key, category text, unit text, supplier text, daily_usage numeric);
insert into tmp_supply values
  -- Cold drink service
  ('Cold Cup 16oz','Cups','piece','Packaging Supplier', 200),
  ('Cold Cup Lid','Lids','piece','Packaging Supplier', 200),
  ('Straw','Drinkware','piece','Packaging Supplier', 200),
  -- Hot drink service
  ('Hot Cup 12oz','Cups','piece','Packaging Supplier', 60),
  ('Hot Cup Lid','Lids','piece','Packaging Supplier', 60),
  ('Cup Sleeve','Drinkware','piece','Packaging Supplier', 60),
  -- Food service
  ('Food Container','Food Packaging','piece','Packaging Supplier', 70),
  ('Cake Box','Food Packaging','piece','Packaging Supplier', 20),
  ('Cookie Box','Food Packaging','piece','Packaging Supplier', 10),
  ('Takeout Bag','Bags','piece','Packaging Supplier', 90),
  ('Cutlery Set','Food Packaging','piece','Packaging Supplier', 70),
  -- Table and counter
  ('Napkin','Paper Goods','piece','General Supplier', 260),
  ('Tissue Roll','Paper Goods','piece','General Supplier', 6);

-- ---------------------------------------------------------------------
-- STEP 2 — PRODUCT MAPPINGS
-- ---------------------------------------------------------------------
-- product_slug NULL  => order-level supply, deducted once per qualifying
--                       order rather than once per item.
-- temperature NULL   => applies whether the item is served hot or iced.
-- service NULL       => applies to both dine-in and takeout.
create temp table tmp_supply_map (
  product_slug text, supply_name text, qty numeric,
  temperature text, service text, note text
);

-- 2a. Drinks. Every drink gets a cup + lid, and then either a straw (iced)
--     or a sleeve (hot). Conditions are resolved per order line from the
--     temperature the drink was actually sold at.
insert into tmp_supply_map
select d.slug, m.supply_name, 1, m.temperature, null, m.note
from (values
  ('earl-grey-oat-matcha-latte'),('hojicha-coconut-cloud'),('taho-latte'),
  ('black-sesame-matcha-latte'),('passion-fruit-yuzu-black-tea'),('biscoff-latte'),
  ('maple-oat-latte'),('spanish-latte'),('seasalt-latte'),('white-mocha'),
  ('caramel-latte'),('dark-mocha-latte'),('americano'),('latte'),('cappuccino'),
  ('matcha-latte'),('dark-white-chocolate'),('lychee-fruit-tea'),('lemon-fruit-tea'),
  ('iced-shaken-honey-citron-tea'),('pink-milk'),('strawberry-milk'),('thai-milktea')
) as d(slug)
cross join (values
  ('Cold Cup 16oz','iced','Iced service'),
  ('Cold Cup Lid','iced','Iced service'),
  ('Straw','iced','Iced service'),
  ('Hot Cup 12oz','hot','Hot service'),
  ('Hot Cup Lid','hot','Hot service'),
  ('Cup Sleeve','hot','Hot service')
) as m(supply_name, temperature, note);

-- 2b. Food served on a plate in-store, packed in a container to go.
--     A napkin goes out either way; cutlery only when it leaves.
insert into tmp_supply_map
select f.slug, m.supply_name, 1, null, m.service, m.note
from (values
  ('beef-tapa'),('bangus'),('katsu-curry'),('corned-beef-spam'),('hungarian'),
  ('chicken-tenders'),('nuggets'),('potato-wedges'),('classic-nachos'),
  ('alfredo'),('pesto'),('spicy-peanut'),('mac-and-cheese')
) as f(slug)
cross join (values
  ('Food Container','takeout','Packed to go'),
  ('Cutlery Set','takeout','Packed to go'),
  ('Napkin',null,'Served with every meal')
) as m(supply_name, service, note);

-- 2b-ii. Extra rice is packed in its own container when taken away. The
--     other add-ons (Scrambled Egg, Sunny Side Up Egg, Cheese Sauce, Salsa)
--     are deliberately left unmapped: they are served on, or in, the main
--     dish's plate or container, so giving each one its own packaging would
--     over-deduct on every combo order.
insert into tmp_supply_map values
  ('plain-rice','Food Container',1,null,'takeout','Extra rice packed separately');

-- 2c. Cakes: boxed only when taken away, eaten on a plate in-store.
insert into tmp_supply_map
select c.slug, 'Cake Box', 1, null, 'takeout', 'Cake takeaway box'
from (values
  ('blueberry-cheesecake'),('matcha-cheesecake'),('leche-flan-cheesecake'),
  ('basque-burnt-cheesecake'),('biscoff-burnt-cheesecake'),('carrot-walnut-cake'),
  ('red-velvet-cake'),('tiramisu')
) as c(slug);

-- 2d. Cookie boxes are always boxed — the box IS the product.
insert into tmp_supply_map values
  ('bestseller-box','Cookie Box',1,null,null,'Box of 3'),
  ('sampler-box-of-6','Cookie Box',1,null,null,'Box of 6');

-- 2e. Single cookies get NO per-item bag.
--     An earlier version of this seed mapped a Takeout Bag to each single
--     cookie as well as to the order as a whole (2f). Both used the same
--     supply, so a takeout order containing a cookie drew two bags —
--     confirmed live on order CR-20260807-160143-9A59, which deducted one
--     bag for the cookie line and one for the order. The order-level bag in
--     2f already covers anything leaving the shop, so the per-cookie
--     mapping was redundant and is deliberately absent.
--
--     If cookies should genuinely get their own small sleeve or paper bag
--     in ADDITION to the carrier bag, add it as a SEPARATE supply record
--     rather than reusing 'Takeout Bag' — otherwise the two purposes
--     collapse into one counter again.

-- 2f. ORDER-LEVEL: one takeout bag per order that leaves the shop.
--     product_slug is null, so this is spent once per order regardless of
--     how many dishes it contains.
insert into tmp_supply_map values
  (null,'Takeout Bag',1,null,'takeout','One bag per takeout order');

-- ---------------------------------------------------------------------
-- STEP 3 — CREATE SUPPLIES, THEN MAP
-- ---------------------------------------------------------------------
-- Opening stock covers 7 operating days; warning level is 2 days. Unlike
-- ingredients this ordering is not load-bearing (no availability engine
-- reads supply stock), but it keeps the two seeds consistent.
insert into public.supplies (name, category, unit, quantity, min_stock_level, high_stock_level, supplier)
select t.name, t.category, t.unit,
       ceil(t.daily_usage * 7), ceil(t.daily_usage * 2), ceil(t.daily_usage * 7),
       t.supplier
from tmp_supply t
where not exists (select 1 from public.supplies s where lower(s.name) = lower(t.name));

insert into public.menu_item_supplies
  (menu_item_id, supply_id, quantity_per_serving, applies_to_temperature, applies_to_service, note)
select mi.id, s.id, m.qty, m.temperature, m.service, m.note
from tmp_supply_map m
join public.supplies s on lower(s.name) = lower(m.supply_name)
left join public.menu_items mi on mi.slug = m.product_slug
where (m.product_slug is null or mi.id is not null)
  and not exists (
    select 1 from public.menu_item_supplies x
    where coalesce(x.menu_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(mi.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and x.supply_id = s.id
      and coalesce(x.applies_to_temperature,'') = coalesce(m.temperature,'')
      and coalesce(x.applies_to_service,'') = coalesce(m.service,'')
  );

-- ---------------------------------------------------------------------
-- STEP 4 — CORRECTION: retire "Cookie Box Packaging" from ingredients
-- ---------------------------------------------------------------------
-- seed_product_recipes.sql filed cookie-box packaging under
-- public.ingredients, because at that point the deduction engine could only
-- read ingredients and there was no way to spend a supply. Now that
-- supplies deduct properly, the same box would be counted twice — once as
-- an ingredient and once as a supply.
--
-- This removes the two ingredient recipe lines and archives the ingredient.
-- The ingredient row itself is kept (not deleted) so its past movement
-- history stays readable. This is the only DELETE in the file.
delete from public.menu_item_ingredients
where ingredient_id in (
  select id from public.ingredients where lower(name) = lower('Cookie Box Packaging')
);

update public.ingredients
set is_archived = true,
    notes = coalesce(nullif(notes,'') || ' | ', '')
            || 'Retired 2026-08-07: cookie boxes are now tracked as a supply (Cookie Box), not an ingredient.'
where lower(name) = lower('Cookie Box Packaging') and not is_archived;

commit;

-- =====================================================================
-- VALIDATION — run each separately after the seed commits.
-- =====================================================================

-- S1. Every supply with its stock, levels and status.
-- select s.name, s.category, s.quantity, s.unit,
--        s.min_stock_level as warning, s.high_stock_level as reorder,
--        case when s.is_archived then 'Inactive'
--             when s.quantity <= 0 then 'Out of Stock'
--             when s.quantity <= s.min_stock_level then 'Low Stock'
--             else 'In Stock' end as status,
--        s.supplier, s.updated_at
-- from public.supplies s order by s.is_archived, s.name;

-- S2. Full mapping: which products consume which supplies, under what
--     conditions. A null product is an order-level supply.
-- select coalesce(mi.name,'(whole order)') as product, s.name as supply,
--        ms.quantity_per_serving as qty, s.unit,
--        coalesce(ms.applies_to_temperature,'any') as temperature,
--        coalesce(ms.applies_to_service,'any') as service, ms.note
-- from public.menu_item_supplies ms
-- join public.supplies s on s.id = ms.supply_id
-- left join public.menu_items mi on mi.id = ms.menu_item_id
-- order by product, s.name;

-- S3. Reverse view: which products use each supply.
-- select s.name as supply, count(ms.id) as mappings,
--        string_agg(coalesce(mi.name,'(whole order)'), ', ' order by mi.name) as products
-- from public.supplies s
-- left join public.menu_item_supplies ms on ms.supply_id = s.id
-- left join public.menu_items mi on mi.id = ms.menu_item_id
-- group by s.name order by mappings desc, s.name;

-- S4. Supplies not connected to any product (manual-count only — expected
--     for things like Tissue Roll that are not consumed per sale).
-- select s.name, s.category, s.quantity, s.unit from public.supplies s
-- where not s.is_archived
--   and not exists (select 1 from public.menu_item_supplies x where x.supply_id = s.id)
-- order by s.name;

-- S5. Double-tracking check — a name held as BOTH an ingredient and a
--     supply. Must return zero rows.
-- select i.name from public.ingredients i
-- join public.supplies s on lower(s.name) = lower(i.name)
-- where not i.is_archived and not s.is_archived;

-- S6. Supply movements from real orders, newest first.
-- select o.order_number, o.order_type, s.name as supply,
--        m.quantity, s.unit, m.reason, m.created_at
-- from public.supply_movements m
-- join public.supplies s on s.id = m.supply_id
-- left join public.orders o on o.id = m.order_id
-- where m.movement_type = 'deduction'
-- order by m.created_at desc limit 100;

-- S7. Days of cover per supply at the planned run rate.
-- select s.name, s.quantity, s.unit, s.min_stock_level as warning,
--        case when s.min_stock_level > 0
--             then round(s.quantity / (s.min_stock_level / 2.0), 1) end as days_of_cover
-- from public.supplies s where not s.is_archived
-- order by days_of_cover asc nulls last;
