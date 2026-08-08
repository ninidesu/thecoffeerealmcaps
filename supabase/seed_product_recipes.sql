-- =====================================================================
-- PRODUCT RECIPE SEED — thecoffeerealm
-- =====================================================================
-- Assigns a complete per-serving ingredient recipe to every active menu
-- product, and gives every ingredient a realistic opening stock plus
-- warning/par levels derived from estimated daily sales.
--
-- DATA ONLY. This script creates no tables, columns, functions, policies,
-- or triggers. It writes to the tables that already exist and that the
-- order-deduction system already reads:
--     public.ingredients
--     public.inventory_stock
--     public.menu_item_ingredients   <- the single recipe source
--
-- IT IS SAFE AND IDEMPOTENT:
--   * An ingredient is created only when no ingredient with that name
--     (case-insensitive) already exists. Existing rows are reused, never
--     renamed, re-united, or duplicated.
--   * A stock row is created only for ingredients that have none. Existing
--     quantities and thresholds are left completely untouched.
--   * A recipe line is inserted only when that exact product+ingredient
--     pair does not already exist. No existing recipe line is ever changed
--     or deleted, so hand-tuned recipes survive a re-run.
--
-- ORDER MATTERS. public.recompute_menu_item_availability() flips a product
-- to unavailable ('missing_ingredient' / 'insufficient_stock') the instant
-- it is linked to an ingredient with too little stock, and a trigger fires
-- that function on every menu_item_ingredients insert. Stock is therefore
-- seeded in STEP 3, BEFORE any recipe line is written in STEP 4. Do not
-- reorder these steps or you will take the whole menu offline.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Then run the
-- VALIDATION PACK at the bottom (each query separately) to review results.
--
-- TUNING: STEP 1 holds the planning assumptions (estimated orders per day
-- per product). They are planning inputs, not facts — edit them to match
-- real sales and re-run to get better thresholds for new ingredients.
-- =====================================================================

begin;

-- Temp tables are session-scoped, so clear them first to keep a second run
-- inside the same SQL Editor session from failing on "already exists".
drop table if exists tmp_planning;
drop table if exists tmp_policy;
drop table if exists tmp_ingredient;
drop table if exists tmp_recipe;
drop table if exists tmp_usage;

-- ---------------------------------------------------------------------
-- STEP 1 — PLANNING ASSUMPTIONS (edit these)
-- ---------------------------------------------------------------------
-- Estimated orders per operating day, per product. Used only to derive
-- opening stock and thresholds for NEWLY created ingredients. Changing a
-- number here never changes a recipe quantity.
create temp table tmp_planning (product_slug text primary key, daily_orders numeric not null);
insert into tmp_planning values
  ('earl-grey-oat-matcha-latte',15), ('hojicha-coconut-cloud',12), ('taho-latte',5),
  ('black-sesame-matcha-latte',12), ('passion-fruit-yuzu-black-tea',10), ('biscoff-latte',15),
  ('maple-oat-latte',12), ('spanish-latte',30), ('seasalt-latte',15), ('white-mocha',15),
  ('caramel-latte',18), ('dark-mocha-latte',15), ('americano',20), ('latte',25), ('cappuccino',15),
  ('matcha-latte',20), ('dark-white-chocolate',12), ('lychee-fruit-tea',10), ('lemon-fruit-tea',10),
  ('iced-shaken-honey-citron-tea',12), ('pink-milk',10), ('strawberry-milk',12), ('thai-milktea',15),
  ('beef-tapa',12), ('bangus',8), ('katsu-curry',10), ('corned-beef-spam',8), ('hungarian',10),
  ('chicken-tenders',10),
  ('nuggets',10), ('potato-wedges',10), ('classic-nachos',8),
  ('alfredo',10), ('pesto',8), ('spicy-peanut',8), ('mac-and-cheese',10),
  ('plain-rice',15), ('scrambled-egg',10), ('sunny-side-up-egg',10), ('cheese-sauce',8), ('salsa',6),
  ('blueberry-cheesecake',5), ('matcha-cheesecake',5), ('leche-flan-cheesecake',5),
  ('basque-burnt-cheesecake',5), ('biscoff-burnt-cheesecake',5), ('carrot-walnut-cake',5),
  ('red-velvet-cake',5), ('tiramisu',5),
  ('bestseller-box',4), ('chocolate-chip-cookie',6), ('red-velvet-cookie',6), ('biscoff-cookie',6),
  ('macadamia-cookie',6), ('matcha-cookie',6), ('smores-cookie',6), ('walnut-cookie',6),
  ('sampler-box-of-6',3);

-- Coverage days used to derive levels for newly created ingredients.
--   opening stock / par level = PAR_DAYS of expected consumption
--   warning level             = WARN_DAYS of expected consumption
create temp table tmp_policy (par_days numeric, warn_days numeric);
insert into tmp_policy values (7, 2);

-- ---------------------------------------------------------------------
-- STEP 2 — INGREDIENT MASTER
-- ---------------------------------------------------------------------
-- Base units are deliberately uniform so recipe quantities are never
-- ambiguous and the deduction engine (which does no unit conversion) is
-- always comparing like with like:
--     liquids       -> ml
--     dry / solids  -> g
--     countable     -> piece
--     cake portions -> slice
-- Espresso is tracked as GRAMS OF BEANS, not as "shots", because beans are
-- what is actually purchased and stocked. One double shot = 18 g.
create temp table tmp_ingredient (name text primary key, category text, type text, unit text);
insert into tmp_ingredient values
  -- Coffee & tea
  ('Espresso Beans','Coffee','dry','g'),
  ('Black Tea Leaves','Tea','dry','g'),
  ('Thai Tea Leaves','Tea','dry','g'),
  -- Milk & dairy
  ('Fresh Milk','Dairy','wet','ml'),
  ('Oat Milk','Dairy Alternative','wet','ml'),
  ('Soy Milk','Dairy Alternative','wet','ml'),
  ('Evaporated Milk','Dairy','wet','ml'),
  ('Condensed Milk','Dairy','wet','ml'),
  ('Heavy Cream','Dairy','wet','ml'),
  -- Powders & pastes
  ('Matcha Powder','Powder','dry','g'),
  ('Hojicha Powder','Powder','dry','g'),
  ('Black Sesame Paste','Powder','dry','g'),
  ('Cinnamon Powder','Powder','dry','g'),
  ('Biscoff Spread','Spread','dry','g'),
  ('Honey Citron Jam','Spread','dry','g'),
  -- Syrups & sauces (drinks)
  ('Simple Syrup','Syrup','wet','ml'),
  ('Earl Grey Syrup','Syrup','wet','ml'),
  ('Maple Syrup','Syrup','wet','ml'),
  ('Caramel Syrup','Syrup','wet','ml'),
  ('Caramel Sauce','Sauce','wet','ml'),
  ('Lychee Syrup','Syrup','wet','ml'),
  ('Lemon Syrup','Syrup','wet','ml'),
  ('Yuzu Syrup','Syrup','wet','ml'),
  ('Sala Syrup','Syrup','wet','ml'),
  ('Arnibal Syrup','Syrup','wet','ml'),
  ('Dark Chocolate Sauce','Sauce','wet','ml'),
  ('White Chocolate Sauce','Sauce','wet','ml'),
  ('Strawberry Puree','Fruit','wet','ml'),
  ('Passion Fruit Puree','Fruit','wet','ml'),
  -- Drink extras
  ('Coconut Water','Beverage Base','wet','ml'),
  ('Drinking Water','Beverage Base','wet','ml'),
  ('Ice','Beverage Base','wet','g'),
  ('Sea Salt','Seasoning','dry','g'),
  ('Marshmallow','Topping','dry','g'),
  ('Sago Pearls','Topping','dry','g'),
  -- Rice, egg, oil
  ('Rice','Grain','dry','g'),
  ('Egg','Protein','other','piece'),
  ('Cooking Oil','Pantry','wet','ml'),
  -- Proteins
  ('Beef Tapa','Protein','dry','g'),
  ('Bangus Fillet','Protein','other','piece'),
  ('Pork Katsu','Protein','dry','g'),
  ('Corned Beef','Protein','dry','g'),
  ('Spam','Protein','dry','g'),
  ('Hungarian Sausage','Protein','other','piece'),
  ('Chicken Tenders','Protein','dry','g'),
  ('Chicken Nuggets','Protein','dry','g'),
  -- Vegetables & sides
  ('Potato','Produce','dry','g'),
  ('Carrot','Produce','dry','g'),
  ('Spring Onion','Produce','dry','g'),
  ('Shoestring Fries','Frozen','dry','g'),
  ('Potato Wedges','Frozen','dry','g'),
  ('Nacho Chips','Dry Goods','dry','g'),
  -- Sauces & condiments (food)
  ('Japanese Curry Sauce','Sauce','wet','ml'),
  ('Cheese Sauce','Sauce','wet','ml'),
  ('Salsa','Sauce','wet','ml'),
  ('White Sauce','Sauce','wet','ml'),
  ('Pesto Sauce','Sauce','wet','ml'),
  ('Chili Peanut Sauce','Sauce','wet','ml'),
  ('Ketchup','Condiment','wet','ml'),
  ('Mustard','Condiment','wet','ml'),
  ('Fries Seasoning','Seasoning','dry','g'),
  -- Pasta & bakery staples
  ('Fettuccine Pasta','Dry Goods','dry','g'),
  ('Penne Pasta','Dry Goods','dry','g'),
  ('Macaroni Pasta','Dry Goods','dry','g'),
  ('Knife-cut Noodles','Dry Goods','dry','g'),
  ('Loaf Bread','Bakery','other','piece'),
  ('Butter','Dairy','dry','g'),
  ('Parmesan Cheese','Dairy','dry','g'),
  ('Cheddar Cheese','Dairy','dry','g'),
  -- Ready-made cakes, sold by the slice (see note in STEP 4)
  ('Blueberry Cheesecake','Bakery - Ready Made','other','slice'),
  ('Matcha Cheesecake','Bakery - Ready Made','other','slice'),
  ('Leche Flan Cheesecake','Bakery - Ready Made','other','slice'),
  ('Basque Burnt Cheesecake','Bakery - Ready Made','other','slice'),
  ('Biscoff Burnt Cheesecake','Bakery - Ready Made','other','slice'),
  ('Carrot Walnut Cake','Bakery - Ready Made','other','slice'),
  ('Red Velvet Cake','Bakery - Ready Made','other','slice'),
  ('Tiramisu Cake','Bakery - Ready Made','other','slice'),
  -- Ready-made cookies, sold by the piece
  ('Chocolate Chip Cookie','Bakery - Ready Made','other','piece'),
  ('Red Velvet Cookie','Bakery - Ready Made','other','piece'),
  ('Biscoff Cookie','Bakery - Ready Made','other','piece'),
  ('Macadamia Cookie','Bakery - Ready Made','other','piece'),
  ('Matcha Cookie','Bakery - Ready Made','other','piece'),
  ('Smores Cookie','Bakery - Ready Made','other','piece'),
  ('Walnut Cookie','Bakery - Ready Made','other','piece'),
  ('Cookie Box Packaging','Packaging','other','piece');

-- ---------------------------------------------------------------------
-- RECIPES — quantity is ALWAYS per one serving / one order unit.
-- ---------------------------------------------------------------------
-- The deduction engine multiplies by the ordered quantity itself, so these
-- must never hold a batch amount. Standards used throughout:
--     double espresso shot = 18 g beans      single shot = 9 g
--     iced 16 oz cup       = 150 g ice       syrup pump  = 15-20 ml
--     brewed tea per cup   = 5 g leaves      cream top   = 30 ml
--
-- ICE IS ASSIGNED ONLY TO iced_only PRODUCTS. menu_item_ingredients has no
-- variant dimension, so a recipe line applies to every temperature. Adding
-- ice to a 'flexible' product would wrongly deduct ice from hot orders.
create temp table tmp_recipe (product_slug text, ingredient_name text, qty numeric, note text);
insert into tmp_recipe values
  -- ===== TCR SPECIALS (iced only) =====
  ('earl-grey-oat-matcha-latte','Matcha Powder',5,'Ceremonial grade, sifted'),
  ('earl-grey-oat-matcha-latte','Oat Milk',180,null),
  ('earl-grey-oat-matcha-latte','Earl Grey Syrup',20,null),
  ('earl-grey-oat-matcha-latte','Simple Syrup',10,null),
  ('earl-grey-oat-matcha-latte','Ice',150,null),

  ('hojicha-coconut-cloud','Hojicha Powder',4,null),
  ('hojicha-coconut-cloud','Coconut Water',150,null),
  ('hojicha-coconut-cloud','Fresh Milk',60,null),
  ('hojicha-coconut-cloud','Heavy Cream',30,'Cloud foam top'),
  ('hojicha-coconut-cloud','Simple Syrup',15,null),
  ('hojicha-coconut-cloud','Ice',150,null),

  ('taho-latte','Soy Milk',180,null),
  ('taho-latte','Sago Pearls',40,'Cooked weight'),
  ('taho-latte','Arnibal Syrup',30,null),
  ('taho-latte','Ice',150,null),

  ('black-sesame-matcha-latte','Matcha Powder',5,null),
  ('black-sesame-matcha-latte','Fresh Milk',180,null),
  ('black-sesame-matcha-latte','Black Sesame Paste',20,'Whipped into foam'),
  ('black-sesame-matcha-latte','Heavy Cream',30,null),
  ('black-sesame-matcha-latte','Simple Syrup',10,null),
  ('black-sesame-matcha-latte','Ice',150,null),

  ('passion-fruit-yuzu-black-tea','Black Tea Leaves',5,null),
  ('passion-fruit-yuzu-black-tea','Passion Fruit Puree',40,null),
  ('passion-fruit-yuzu-black-tea','Yuzu Syrup',25,null),
  ('passion-fruit-yuzu-black-tea','Drinking Water',120,'Brew water'),
  ('passion-fruit-yuzu-black-tea','Ice',150,null),

  ('biscoff-latte','Espresso Beans',18,'Double shot'),
  ('biscoff-latte','Fresh Milk',160,null),
  ('biscoff-latte','Biscoff Spread',30,null),
  ('biscoff-latte','Heavy Cream',30,'Biscoff foam'),
  ('biscoff-latte','Biscoff Cookie',1,'Garnish cookie'),
  ('biscoff-latte','Ice',150,null),

  -- ===== ESPRESSO =====
  ('maple-oat-latte','Espresso Beans',18,'Double shot'),
  ('maple-oat-latte','Oat Milk',180,null),
  ('maple-oat-latte','Maple Syrup',20,null),
  ('maple-oat-latte','Cinnamon Powder',1,null),

  ('spanish-latte','Espresso Beans',18,'Double shot'),
  ('spanish-latte','Fresh Milk',180,null),
  ('spanish-latte','Condensed Milk',25,null),

  ('seasalt-latte','Espresso Beans',18,'Double shot'),
  ('seasalt-latte','Fresh Milk',160,null),
  ('seasalt-latte','Heavy Cream',40,'Seasalt cream top'),
  ('seasalt-latte','Sea Salt',1,null),
  ('seasalt-latte','Simple Syrup',10,null),
  ('seasalt-latte','Ice',150,null),

  ('white-mocha','Espresso Beans',18,'Double shot'),
  ('white-mocha','Fresh Milk',170,null),
  ('white-mocha','White Chocolate Sauce',30,null),
  ('white-mocha','Heavy Cream',30,null),

  ('caramel-latte','Espresso Beans',18,'Double shot'),
  ('caramel-latte','Fresh Milk',180,null),
  ('caramel-latte','Caramel Syrup',20,null),
  ('caramel-latte','Caramel Sauce',15,'Drizzle'),

  ('dark-mocha-latte','Espresso Beans',18,'Double shot'),
  ('dark-mocha-latte','Fresh Milk',180,null),
  ('dark-mocha-latte','Dark Chocolate Sauce',30,null),

  ('americano','Espresso Beans',18,'Double shot'),
  ('americano','Drinking Water',200,null),

  ('latte','Espresso Beans',18,'Double shot'),
  ('latte','Fresh Milk',200,null),

  ('cappuccino','Espresso Beans',18,'Double shot'),
  ('cappuccino','Fresh Milk',180,'Includes foam'),

  -- ===== NON-COFFEE =====
  ('matcha-latte','Matcha Powder',5,null),
  ('matcha-latte','Fresh Milk',200,null),
  ('matcha-latte','Simple Syrup',15,null),

  ('dark-white-chocolate','Fresh Milk',200,null),
  ('dark-white-chocolate','Dark Chocolate Sauce',40,'Swap for white chocolate on request'),
  ('dark-white-chocolate','Heavy Cream',30,null),
  ('dark-white-chocolate','Marshmallow',10,null),

  ('lychee-fruit-tea','Black Tea Leaves',5,null),
  ('lychee-fruit-tea','Lychee Syrup',30,null),
  ('lychee-fruit-tea','Simple Syrup',10,null),
  ('lychee-fruit-tea','Drinking Water',180,'Brew water'),

  ('lemon-fruit-tea','Black Tea Leaves',5,null),
  ('lemon-fruit-tea','Lemon Syrup',30,null),
  ('lemon-fruit-tea','Simple Syrup',10,null),
  ('lemon-fruit-tea','Drinking Water',180,'Brew water'),

  ('iced-shaken-honey-citron-tea','Black Tea Leaves',5,null),
  ('iced-shaken-honey-citron-tea','Honey Citron Jam',30,null),
  ('iced-shaken-honey-citron-tea','Simple Syrup',10,null),
  ('iced-shaken-honey-citron-tea','Drinking Water',150,'Brew water'),
  ('iced-shaken-honey-citron-tea','Ice',150,null),

  ('pink-milk','Sala Syrup',30,null),
  ('pink-milk','Condensed Milk',30,null),
  ('pink-milk','Evaporated Milk',150,null),
  ('pink-milk','Ice',150,null),

  ('strawberry-milk','Fresh Milk',180,null),
  ('strawberry-milk','Strawberry Puree',40,null),
  ('strawberry-milk','Simple Syrup',10,null),
  ('strawberry-milk','Ice',150,null),

  ('thai-milktea','Thai Tea Leaves',8,null),
  ('thai-milktea','Condensed Milk',30,null),
  ('thai-milktea','Evaporated Milk',150,null),
  ('thai-milktea','Ice',150,null),

  -- ===== MEALS =====
  ('beef-tapa','Rice',200,'One cup cooked'),
  ('beef-tapa','Beef Tapa',120,null),
  ('beef-tapa','Egg',1,'Fried'),
  ('beef-tapa','Cooking Oil',15,null),

  ('bangus','Rice',200,null),
  ('bangus','Bangus Fillet',1,'Marinated'),
  ('bangus','Egg',1,'Fried'),
  ('bangus','Cooking Oil',15,null),

  ('katsu-curry','Rice',200,null),
  ('katsu-curry','Pork Katsu',120,null),
  ('katsu-curry','Japanese Curry Sauce',120,null),
  ('katsu-curry','Potato',60,null),
  ('katsu-curry','Carrot',40,null),
  ('katsu-curry','Cooking Oil',20,'Deep fry allowance'),

  ('corned-beef-spam','Rice',200,null),
  ('corned-beef-spam','Corned Beef',90,null),
  ('corned-beef-spam','Spam',60,null),
  ('corned-beef-spam','Egg',1,'Scrambled'),
  ('corned-beef-spam','Cooking Oil',15,null),

  ('hungarian','Rice',200,null),
  ('hungarian','Hungarian Sausage',1,null),
  ('hungarian','Egg',1,'Fried'),
  ('hungarian','Cheddar Cheese',20,null),
  ('hungarian','Cooking Oil',15,null),

  ('chicken-tenders','Chicken Tenders',150,null),
  ('chicken-tenders','Cheese Sauce',40,null),
  ('chicken-tenders','Egg',1,'Scrambled'),
  ('chicken-tenders','Cooking Oil',20,null),

  -- ===== SNACKS =====
  ('nuggets','Chicken Nuggets',150,null),
  ('nuggets','Shoestring Fries',120,null),
  ('nuggets','Ketchup',30,null),
  ('nuggets','Cheese Sauce',40,null),
  ('nuggets','Cooking Oil',30,'Fryer allowance'),

  ('potato-wedges','Potato Wedges',200,null),
  ('potato-wedges','Ketchup',30,null),
  ('potato-wedges','Mustard',20,null),
  ('potato-wedges','Fries Seasoning',3,null),
  ('potato-wedges','Cooking Oil',30,'Fryer allowance'),

  ('classic-nachos','Nacho Chips',120,null),
  ('classic-nachos','Cheese Sauce',60,null),
  ('classic-nachos','Salsa',60,null),

  -- ===== PASTA =====
  ('alfredo','Fettuccine Pasta',150,'Dry weight'),
  ('alfredo','White Sauce',150,null),
  ('alfredo','Chicken Tenders',80,null),
  ('alfredo','Loaf Bread',1,'Toasted'),
  ('alfredo','Butter',10,null),
  ('alfredo','Parmesan Cheese',10,null),

  ('pesto','Penne Pasta',150,'Dry weight'),
  ('pesto','Pesto Sauce',120,null),
  ('pesto','Loaf Bread',1,'Toasted'),
  ('pesto','Butter',10,null),
  ('pesto','Parmesan Cheese',10,null),

  ('spicy-peanut','Knife-cut Noodles',150,'Dry weight'),
  ('spicy-peanut','Chili Peanut Sauce',120,null),
  ('spicy-peanut','Spring Onion',5,'Garnish'),

  ('mac-and-cheese','Macaroni Pasta',150,'Dry weight'),
  ('mac-and-cheese','Cheese Sauce',150,null),
  ('mac-and-cheese','Loaf Bread',1,'Toasted'),
  ('mac-and-cheese','Butter',10,null),

  -- ===== ADD ONS (sold as their own line items, so they deduct on top
  --       of whatever main dish shares the same order) =====
  ('plain-rice','Rice',200,null),
  ('scrambled-egg','Egg',1,null),
  ('scrambled-egg','Cooking Oil',10,null),
  ('sunny-side-up-egg','Egg',1,null),
  ('sunny-side-up-egg','Cooking Oil',10,null),
  ('cheese-sauce','Cheese Sauce',60,null),
  ('salsa','Salsa',60,null),

  -- ===== CAKES — one slice of ready-made cake per order =====
  ('blueberry-cheesecake','Blueberry Cheesecake',1,'One slice'),
  ('matcha-cheesecake','Matcha Cheesecake',1,'One slice'),
  ('leche-flan-cheesecake','Leche Flan Cheesecake',1,'One slice'),
  ('basque-burnt-cheesecake','Basque Burnt Cheesecake',1,'One slice'),
  ('biscoff-burnt-cheesecake','Biscoff Burnt Cheesecake',1,'One slice'),
  ('carrot-walnut-cake','Carrot Walnut Cake',1,'One slice'),
  ('red-velvet-cake','Red Velvet Cake',1,'One slice'),
  ('tiramisu','Tiramisu Cake',1,'One slice'),

  -- ===== COOKIES — one piece per order =====
  ('chocolate-chip-cookie','Chocolate Chip Cookie',1,null),
  ('red-velvet-cookie','Red Velvet Cookie',1,null),
  ('biscoff-cookie','Biscoff Cookie',1,null),
  ('macadamia-cookie','Macadamia Cookie',1,null),
  ('matcha-cookie','Matcha Cookie',1,null),
  ('smores-cookie','Smores Cookie',1,null),
  ('walnut-cookie','Walnut Cookie',1,null),

  -- ===== COOKIE BOXES — CONFIRM THE FLAVOUR MIX =====
  -- The box contents are a business decision, not something derivable from
  -- the catalogue. These are reasonable drafts: the 3-piece box holds the
  -- three best sellers, the 6-piece sampler holds one of each core flavour.
  -- Adjust in Product Recipes if the real mix differs.
  ('bestseller-box','Chocolate Chip Cookie',1,'DRAFT - confirm box mix'),
  ('bestseller-box','Biscoff Cookie',1,'DRAFT - confirm box mix'),
  ('bestseller-box','Red Velvet Cookie',1,'DRAFT - confirm box mix'),
  ('bestseller-box','Cookie Box Packaging',1,null),

  ('sampler-box-of-6','Chocolate Chip Cookie',1,'DRAFT - confirm box mix'),
  ('sampler-box-of-6','Biscoff Cookie',1,'DRAFT - confirm box mix'),
  ('sampler-box-of-6','Red Velvet Cookie',1,'DRAFT - confirm box mix'),
  ('sampler-box-of-6','Macadamia Cookie',1,'DRAFT - confirm box mix'),
  ('sampler-box-of-6','Matcha Cookie',1,'DRAFT - confirm box mix'),
  ('sampler-box-of-6','Walnut Cookie',1,'DRAFT - confirm box mix'),
  ('sampler-box-of-6','Cookie Box Packaging',1,null);

-- Guard: every ingredient referenced by a recipe must exist in the master.
do $$
declare v_missing text;
begin
  select string_agg(distinct r.ingredient_name, ', ')
    into v_missing
  from tmp_recipe r
  where not exists (select 1 from tmp_ingredient t where t.name = r.ingredient_name);
  if v_missing is not null then
    raise exception 'Recipe references ingredients missing from the master list: %', v_missing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- STEP 3 — CREATE MISSING INGREDIENTS, THEN SEED STOCK (before recipes)
-- ---------------------------------------------------------------------
insert into public.ingredients (name, category, type, unit)
select t.name, t.category, t.type, t.unit
from tmp_ingredient t
where not exists (
  select 1 from public.ingredients i where lower(i.name) = lower(t.name)
);

-- Expected consumption per operating day, computed from the recipes
-- themselves multiplied by the planning estimates. Shared ingredients are
-- summed across every product that uses them.
create temp table tmp_usage as
select
  i.id as ingredient_id,
  i.name,
  round(sum(r.qty * coalesce(p.daily_orders, 0)), 2) as daily_usage
from tmp_recipe r
join public.ingredients i on lower(i.name) = lower(r.ingredient_name)
left join tmp_planning p on p.product_slug = r.product_slug
group by i.id, i.name;

-- Opening stock and thresholds, for ingredients that have NO stock row yet.
-- A floor of 10 units keeps low-usage items (garnishes, seasonings) from
-- being seeded at zero, which would instantly mark their products
-- unavailable through recompute_menu_item_availability().
insert into public.inventory_stock (ingredient_id, quantity, min_stock_level, high_stock_level)
select
  u.ingredient_id,
  greatest(ceil(u.daily_usage * (select par_days from tmp_policy)), 10),
  greatest(ceil(u.daily_usage * (select warn_days from tmp_policy)), 5),
  greatest(ceil(u.daily_usage * (select par_days from tmp_policy)), 10)
from tmp_usage u
where not exists (
  select 1 from public.inventory_stock s where s.ingredient_id = u.ingredient_id
);

-- ---------------------------------------------------------------------
-- STEP 4 — MAP THE RECIPES
-- ---------------------------------------------------------------------
-- Additive only: an existing product+ingredient pair is left exactly as it
-- is, so any recipe already tuned by hand survives untouched.
--
-- NOTE ON CAKES AND COOKIES. They are treated as ready-made stock: one sale
-- deducts one slice or one piece, and no raw baking ingredients are
-- deducted. This deliberately avoids the double-deduction the brief warns
-- about. They are modelled in public.ingredients rather than
-- public.finished_products because the order-deduction path reads
-- menu_item_ingredients -> ingredients only; finished_products has no
-- deduction path at all. Do NOT also record these same cakes and cookies in
-- finished_products, or the same sale will be tracked in two places.
insert into public.menu_item_ingredients (menu_item_id, ingredient_id, quantity_per_serving)
select m.id, i.id, r.qty
from tmp_recipe r
join public.menu_items m on m.slug = r.product_slug
join public.ingredients i on lower(i.name) = lower(r.ingredient_name)
where not exists (
  select 1 from public.menu_item_ingredients x
  where x.menu_item_id = m.id and x.ingredient_id = i.id
);

commit;

-- =====================================================================
-- VALIDATION PACK — run each query separately after the seed commits.
-- =====================================================================

-- V1. Coverage: every active product and how many ingredients it now has.
--     Anything showing 0 still needs a recipe.
-- select mi.name as product, sc.display_name as category,
--        count(mii.ingredient_id) as ingredients
-- from public.menu_items mi
-- left join public.subcategories sc on sc.id = mi.subcategory_id
-- left join public.menu_item_ingredients mii on mii.menu_item_id = mi.id
-- where not mi.is_archived
-- group by mi.name, sc.display_name
-- order by ingredients asc, category, product;

-- V2. Full recipe listing, product by product.
-- select mi.name as product, i.name as ingredient,
--        mii.quantity_per_serving as qty, i.unit
-- from public.menu_item_ingredients mii
-- join public.menu_items mi on mi.id = mii.menu_item_id
-- join public.ingredients i on i.id = mii.ingredient_id
-- where not mi.is_archived
-- order by mi.name, i.name;

-- V3. Products with NO ingredients assigned.
-- select mi.name from public.menu_items mi
-- where not mi.is_archived
--   and not exists (select 1 from public.menu_item_ingredients x where x.menu_item_id = mi.id)
-- order by mi.name;

-- V4. Ingredients not used by any product.
-- select i.name, i.unit, coalesce(s.quantity,0) as stock
-- from public.ingredients i
-- left join public.inventory_stock s on s.ingredient_id = i.id
-- where not i.is_archived
--   and not exists (select 1 from public.menu_item_ingredients x where x.ingredient_id = i.id)
-- order by i.name;

-- V5. Invalid recipe quantities (zero, negative, or null).
-- select mi.name as product, i.name as ingredient, mii.quantity_per_serving
-- from public.menu_item_ingredients mii
-- join public.menu_items mi on mi.id = mii.menu_item_id
-- join public.ingredients i on i.id = mii.ingredient_id
-- where mii.quantity_per_serving is null or mii.quantity_per_serving <= 0;

-- V6. Missing or ambiguous units.
-- select name, unit from public.ingredients
-- where not is_archived and (unit is null or btrim(unit) = '' or lower(unit) = 'unit')
-- order by name;

-- V7. Duplicate ingredient mappings on the same product.
-- select mi.name as product, i.name as ingredient, count(*) as rows
-- from public.menu_item_ingredients mii
-- join public.menu_items mi on mi.id = mii.menu_item_id
-- join public.ingredients i on i.id = mii.ingredient_id
-- group by mi.name, i.name having count(*) > 1;

-- V8. Near-duplicate ingredient names (spelling / casing drift).
-- select a.name, b.name from public.ingredients a
-- join public.ingredients b on a.id < b.id
--   and replace(lower(a.name),' ','') = replace(lower(b.name),' ','')
-- order by a.name;

-- V9. Deactivated ingredients still referenced by an active product.
-- select mi.name as product, i.name as ingredient
-- from public.menu_item_ingredients mii
-- join public.menu_items mi on mi.id = mii.menu_item_id
-- join public.ingredients i on i.id = mii.ingredient_id
-- where i.is_archived and not mi.is_archived
-- order by mi.name;

-- V10. Double-deduction risk: a cake or cookie held in BOTH ingredients and
--      finished_products. This must return zero rows.
-- select fp.name from public.finished_products fp
-- join public.ingredients i on lower(i.name) = lower(fp.name)
-- where not fp.is_archived and not i.is_archived;

-- V11. Products blocked from sale by stock, with the ingredient at fault.
-- select mi.name as product, mi.unavailable_reason, i.name as ingredient,
--        coalesce(s.quantity,0) as stock, mii.quantity_per_serving as needed
-- from public.menu_items mi
-- join public.menu_item_ingredients mii on mii.menu_item_id = mi.id
-- join public.ingredients i on i.id = mii.ingredient_id
-- left join public.inventory_stock s on s.ingredient_id = i.id
-- where not mi.is_archived and not mi.is_available
--   and coalesce(s.quantity,0) < mii.quantity_per_serving
-- order by mi.name, i.name;

-- V12. Servings still possible for each product at current stock levels.
-- select mi.name as product,
--        floor(min(coalesce(s.quantity,0) / nullif(mii.quantity_per_serving,0))) as servings_possible
-- from public.menu_items mi
-- join public.menu_item_ingredients mii on mii.menu_item_id = mi.id
-- left join public.inventory_stock s on s.ingredient_id = mii.ingredient_id
-- where not mi.is_archived
-- group by mi.name order by servings_possible asc nulls first;

-- V13. Suggested thresholds for EVERY ingredient, including pre-existing
--      ones the seed did not touch. Compare against the live values and
--      apply by hand where they differ.
-- with usage as (
--   select i.id, i.name, i.unit,
--          sum(mii.quantity_per_serving * plan.daily_orders) as daily_usage
--   from public.menu_item_ingredients mii
--   join public.ingredients i on i.id = mii.ingredient_id
--   join public.menu_items mi on mi.id = mii.menu_item_id
--   join (values
--     ('earl-grey-oat-matcha-latte',15),('hojicha-coconut-cloud',12),('taho-latte',5),
--     ('black-sesame-matcha-latte',12),('passion-fruit-yuzu-black-tea',10),('biscoff-latte',15),
--     ('maple-oat-latte',12),('spanish-latte',30),('seasalt-latte',15),('white-mocha',15),
--     ('caramel-latte',18),('dark-mocha-latte',15),('americano',20),('latte',25),('cappuccino',15),
--     ('matcha-latte',20),('dark-white-chocolate',12),('lychee-fruit-tea',10),('lemon-fruit-tea',10),
--     ('iced-shaken-honey-citron-tea',12),('pink-milk',10),('strawberry-milk',12),('thai-milktea',15),
--     ('beef-tapa',12),('bangus',8),('katsu-curry',10),('corned-beef-spam',8),('hungarian',10),
--     ('chicken-tenders',10),('nuggets',10),('potato-wedges',10),('classic-nachos',8),
--     ('alfredo',10),('pesto',8),('spicy-peanut',8),('mac-and-cheese',10),
--     ('plain-rice',15),('scrambled-egg',10),('sunny-side-up-egg',10),('cheese-sauce',8),('salsa',6),
--     ('blueberry-cheesecake',5),('matcha-cheesecake',5),('leche-flan-cheesecake',5),
--     ('basque-burnt-cheesecake',5),('biscoff-burnt-cheesecake',5),('carrot-walnut-cake',5),
--     ('red-velvet-cake',5),('tiramisu',5),('bestseller-box',4),('chocolate-chip-cookie',6),
--     ('red-velvet-cookie',6),('biscoff-cookie',6),('macadamia-cookie',6),('matcha-cookie',6),
--     ('smores-cookie',6),('walnut-cookie',6),('sampler-box-of-6',3)
--   ) as plan(slug, daily_orders) on plan.slug = mi.slug
--   group by i.id, i.name, i.unit
-- )
-- select u.name, u.unit, u.daily_usage,
--        coalesce(s.quantity,0) as current_stock,
--        s.min_stock_level as current_warning, ceil(u.daily_usage*2) as suggested_warning,
--        s.high_stock_level as current_par,     ceil(u.daily_usage*7) as suggested_par,
--        round(coalesce(s.quantity,0) / nullif(u.daily_usage,0), 1) as days_of_cover
-- from usage u
-- left join public.inventory_stock s on s.ingredient_id = u.id
-- order by days_of_cover asc nulls last;
