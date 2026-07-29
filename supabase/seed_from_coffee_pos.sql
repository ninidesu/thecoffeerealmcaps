-- LEGACY COMPATIBILITY SEED
-- This targets public.categories/public.products. New deployments must use
-- seed_existing_catalog_tables.sql and customer_menu_configuration.sql instead.
--
-- Seed thecoffeerealm catalog from the legacy coffee_pos.sql export.
-- Run after supabase/cashier_schema.sql in Supabase SQL Editor.

insert into public.categories (name, slug, sort_order, is_active) values
  ('TCR Specials', 'tcr-specials', 1, true),
  ('Meals', 'meals', 1, true),
  ('Espresso', 'espresso', 2, true),
  ('Cookies', 'cookies', 2, true),
  ('Non-Coffee', 'non-coffee', 3, true),
  ('Cakes', 'cakes', 3, true),
  ('Pasta', 'pasta', 4, true),
  ('Add Ons', 'add-ons', 5, true),
  ('Snacks', 'snacks', 6, true)
on conflict (slug) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.products (name, slug, category_id, category_name, description, price, image_url, image_path, main_category, subcategory, is_available, is_active, allow_addons, allow_sugar, allow_ice, temperature_type, variant_config)
select seed.name, seed.slug, c.id, seed.category_name, seed.description, seed.price, seed.image_url, seed.image_path, seed.main_category, seed.subcategory, seed.is_available, seed.is_active, seed.allow_addons, seed.allow_sugar, seed.allow_ice, seed.temperature_type, seed.variant_config::jsonb
from (values
  ('Earl Grey Oat Matcha Latte', 'earl-grey-oat-matcha-latte', 'TCR Specials', 'Ceremonial grade matcha, oat milk, earl grey syrup', 185.0, 'assets/img/TCR Specials/EarlGreyOatMatchaLatte.jpg', 'assets/img/TCR Specials/EarlGreyOatMatchaLatte.jpg', 'drinks', 'tcr_specials', true, true, true, true, true, 'iced_only', '{}'),
  ('Maple Oat Latte', 'maple-oat-latte', 'Espresso', 'Double shot espresso, milk, maple syrup, cinnamon', 185.0, 'assets/img/Espresso/MapleOatLatte.jpg', 'assets/img/Espresso/MapleOatLatte.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Matcha Latte', 'matcha-latte', 'Non-Coffee', 'Ceremonial grade matcha, milk', 150.0, 'assets/img/Non-Coffee/MatchaLatte.jpg', 'assets/img/Non-Coffee/MatchaLatte.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'flexible', '{}'),
  ('Beef Tapa', 'beef-tapa', 'Meals', 'Plain rice, classic beef tapa, fried egg', 175.0, 'assets/img/meals/BeefTapa.jpg', 'assets/img/meals/BeefTapa.jpg', 'foods', 'meals', true, true, false, false, false, 'none', '{}'),
  ('Nuggets', 'nuggets', 'Snacks', 'Shoestring fries, crispy chicken nuggets with ketchup and cheese on the side', 225.0, 'assets/img/Snacks/Nuggets&Fries.jpg', 'assets/img/Snacks/Nuggets&Fries.jpg', 'foods', 'snacks', true, true, false, false, false, 'none', '{}'),
  ('Alfredo', 'alfredo', 'Pasta', 'Fettuccine pasta, toasted loaf, white sauce, chicken tenders', 240.0, 'assets/img/Pasta/Alfredo.jpg', 'assets/img/Pasta/Alfredo.jpg', 'foods', 'pasta', true, true, false, false, false, 'none', '{}'),
  ('Plain Rice', 'plain-rice', 'Add Ons', 'Extra plain rice', 25.0, 'assets/img/Add-ons/PlainRice.jpg', 'assets/img/Add-ons/PlainRice.jpg', 'foods', 'add_ons', true, true, false, false, false, 'none', '{}'),
  ('Blueberry Cheesecake', 'blueberry-cheesecake', 'Cakes', 'Creamy cheesecake topped with sweet blueberry compote', 245.0, 'assets/img/Cakes/BlueberryCheesecake.jpg', 'assets/img/Cakes/BlueberryCheesecake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":245,"whole":1900},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Bestseller Box', 'bestseller-box', 'Cookies', 'Assorted top-selling cookies in one box', 365.0, 'assets/img/Cookies/bestseller_box.JPG', 'assets/img/Cookies/bestseller_box.JPG', 'foods', 'cookies', true, true, false, false, false, 'none', '{"type":"cookie_box","prices":{"box3":365,"box6":750},"labels":{"box3":"Box of 3","box6":"Box of 6"}}'),
  ('Hojicha Coconut Cloud', 'hojicha-coconut-cloud', 'TCR Specials', 'Hojicha powder, coconut water, cream, sweetener', 175.0, 'assets/img/TCR Specials/HojichaCoconutCloud.png', 'assets/img/TCR Specials/HojichaCoconutCloud.png', 'drinks', 'tcr_specials', true, true, true, true, true, 'iced_only', '{}'),
  ('Spanish Latte', 'spanish-latte', 'Espresso', 'Double shot espresso, milk, condensed milk', 160.0, 'assets/img/Espresso/SpanishLatte.jpg', 'assets/img/Espresso/SpanishLatte.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Dark/White Chocolate', 'dark-white-chocolate', 'Non-Coffee', 'Milk, dark or white chocolate, cream, mallows', 140.0, 'assets/img/Non-Coffee/DarkChocolate.jpg', 'assets/img/Non-Coffee/DarkChocolate.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'flexible', '{}'),
  ('Bangus', 'bangus', 'Meals', 'Plain rice, marinated bangus, fried egg', 185.0, 'assets/img/meals/Bangus.jpg', 'assets/img/meals/Bangus.jpg', 'foods', 'meals', true, true, false, false, false, 'none', '{}'),
  ('Potato Wedges', 'potato-wedges', 'Snacks', 'Seasoned crispy potato wedges with ketchup and mustard', 185.0, 'assets/img/Snacks/PotatoWedge.jpg', 'assets/img/Snacks/PotatoWedge.jpg', 'foods', 'snacks', true, true, false, false, false, 'none', '{}'),
  ('Pesto', 'pesto', 'Pasta', 'Penne pasta, toasted loaf, pesto sauce (basil and pine nuts)', 205.0, 'assets/img/Pasta/Pesto.png', 'assets/img/Pasta/Pesto.png', 'foods', 'pasta', true, true, false, false, false, 'none', '{}'),
  ('Scrambled Egg', 'scrambled-egg', 'Add Ons', 'Extra scrambled egg', 20.0, 'assets/img/Add-ons/ScrambledEgg.jpg', 'assets/img/Add-ons/ScrambledEgg.jpg', 'foods', 'add_ons', true, true, false, false, false, 'none', '{}'),
  ('Matcha Cheesecake', 'matcha-cheesecake', 'Cakes', 'Smooth cheesecake infused with rich matcha flavor', 265.0, 'assets/img/Cakes/MatchaCheesecake.jpg', 'assets/img/Cakes/MatchaCheesecake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":265,"whole":2100},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Chocolate Chip', 'chocolate-chip-cookie', 'Cookies', 'Soft cookie loaded with rich chocolate chips', 125.0, 'assets/img/Cookies/ChocolateChip.webp', 'assets/img/Cookies/ChocolateChip.webp', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Taho Latte', 'taho-latte', 'TCR Specials', 'Soy milk, sago, arnibal', 170.0, 'assets/img/TCR Specials/TahoLatte.jpg', 'assets/img/TCR Specials/TahoLatte.jpg', 'drinks', 'tcr_specials', false, true, true, true, true, 'iced_only', '{}'),
  ('Seasalt Latte', 'seasalt-latte', 'Espresso', 'Double shot espresso, milk, seasalt cream', 175.0, 'assets/img/Espresso/SeasaltLatte.jpg', 'assets/img/Espresso/SeasaltLatte.jpg', 'drinks', 'espresso', true, true, true, true, true, 'iced_only', '{}'),
  ('Lychee Fruit Tea', 'lychee-fruit-tea', 'Non-Coffee', 'Black tea, lychee syrup, sweetener', 110.0, 'assets/img/Non-Coffee/LycheeFruitTea.jpg', 'assets/img/Non-Coffee/LycheeFruitTea.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'flexible', '{}'),
  ('Katsu Curry', 'katsu-curry', 'Meals', 'Plain rice, crispy tonkatsu, Japanese curry sauce, potato, carrots', 195.0, 'assets/img/meals/KatsuCurry.jpg', 'assets/img/meals/KatsuCurry.jpg', 'foods', 'meals', true, true, false, false, false, 'none', '{}'),
  ('Classic Nachos', 'classic-nachos', 'Snacks', 'Fried nacho chips, melted cheese, chunky salsa', 195.0, 'assets/img/Snacks/ClassicNachos.jpg', 'assets/img/Snacks/ClassicNachos.jpg', 'foods', 'snacks', true, true, false, false, false, 'none', '{}'),
  ('Spicy Peanut', 'spicy-peanut', 'Pasta', 'Knife-cut noodles, homemade chili peanut sauce', 205.0, 'assets/img/Pasta/SpicyPeanutNoodle.jpg', 'assets/img/Pasta/SpicyPeanutNoodle.jpg', 'foods', 'pasta', true, true, false, false, false, 'none', '{}'),
  ('Sunny Side Up Egg', 'sunny-side-up-egg', 'Add Ons', 'Extra sunny side up egg', 20.0, 'assets/img/Add-ons/SunnySideUpEgg.jpg', 'assets/img/Add-ons/SunnySideUpEgg.jpg', 'foods', 'add_ons', true, true, false, false, false, 'none', '{}'),
  ('Leche Flan Cheesecake', 'leche-flan-cheesecake', 'Cakes', 'Creamy cheesecake layered with caramelized leche flan', 245.0, 'assets/img/Cakes/LecheFlanCheesecake.jpg', 'assets/img/Cakes/LecheFlanCheesecake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":245,"whole":2400},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Red Velvet', 'red-velvet-cookie', 'Cookies', 'Soft red velvet cookie with a creamy center', 135.0, 'assets/img/Cookies/RedVelvet.jpg', 'assets/img/Cookies/RedVelvet.jpg', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Black Sesame Matcha Latte', 'black-sesame-matcha-latte', 'TCR Specials', 'Ceremonial grade matcha, milk, black sesame foam', 175.0, 'assets/img/TCR Specials/BlackSesameMatchaLatte.jpg', 'assets/img/TCR Specials/BlackSesameMatchaLatte.jpg', 'drinks', 'tcr_specials', true, true, true, true, true, 'iced_only', '{}'),
  ('White Mocha', 'white-mocha', 'Espresso', 'Double shot espresso, milk, white chocolate, cream', 170.0, 'assets/img/Espresso/WhiteMocha.jpg', 'assets/img/Espresso/WhiteMocha.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Lemon Fruit Tea', 'lemon-fruit-tea', 'Non-Coffee', 'Black tea, lemon syrup, sweetener', 110.0, 'assets/img/Non-Coffee/LemonFruitTea.jpg', 'assets/img/Non-Coffee/LemonFruitTea.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'flexible', '{}'),
  ('Corned Beef + Spam', 'corned-beef-spam', 'Meals', 'Plain rice, corned beef, spam, scrambled egg', 185.0, 'assets/img/meals/CornBeefSpam.jpg', 'assets/img/meals/CornBeefSpam.jpg', 'foods', 'meals', true, true, false, false, false, 'none', '{}'),
  ('Mac and Cheese', 'mac-and-cheese', 'Pasta', 'Macaroni pasta, toasted loaf, cheesy sauce', 195.0, 'assets/img/Pasta/Mac&Cheese.jpg', 'assets/img/Pasta/Mac&Cheese.jpg', 'foods', 'pasta', true, true, false, false, false, 'none', '{}'),
  ('Cheese Sauce', 'cheese-sauce', 'Add Ons', 'Extra cheese sauce', 30.0, 'assets/img/Add-ons/cheesesauce.webp', 'assets/img/Add-ons/cheesesauce.webp', 'foods', 'add_ons', true, true, false, false, false, 'none', '{}'),
  ('Basque Burnt Cheesecake', 'basque-burnt-cheesecake', 'Cakes', 'Soft, caramelized cheesecake with a burnt top', 225.0, 'assets/img/Cakes/BurntBasqueCheesecake.jpg', 'assets/img/Cakes/BurntBasqueCheesecake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":225,"whole":2200},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Biscoff', 'biscoff-cookie', 'Cookies', 'Sweet cookie with rich biscoff flavor', 125.0, 'assets/img/Cookies/Biscoff.jpg', 'assets/img/Cookies/Biscoff.jpg', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Passion Fruit Yuzu Black Tea', 'passion-fruit-yuzu-black-tea', 'TCR Specials', 'Passion fruit pur?e, yuzu syrup, black tea', 150.0, 'assets/img/TCR Specials/PassionFruitYuzuBlackTea.jpg', 'assets/img/TCR Specials/PassionFruitYuzuBlackTea.jpg', 'drinks', 'tcr_specials', true, true, true, true, true, 'iced_only', '{}'),
  ('Caramel Latte', 'caramel-latte', 'Espresso', 'Double shot espresso, milk, caramel syrup and sauce', 170.0, 'assets/img/Espresso/CaramelLatte.jpg', 'assets/img/Espresso/CaramelLatte.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Iced Shaken Honey Citron Tea', 'iced-shaken-honey-citron-tea', 'Non-Coffee', 'Shaken black tea, honey citron, sweetener', 150.0, 'assets/img/Non-Coffee/IcedShakenHoneyCitron.jpg', 'assets/img/Non-Coffee/IcedShakenHoneyCitron.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'iced_only', '{}'),
  ('Hungarian', 'hungarian', 'Meals', 'Plain rice, cheesy and spicy Hungarian sausage, fried egg', 175.0, 'assets/img/meals/Hungarian.jpg', 'assets/img/meals/Hungarian.jpg', 'foods', 'meals', true, true, false, false, false, 'none', '{}'),
  ('Salsa', 'salsa', 'Add Ons', 'Extra salsa', 30.0, 'assets/img/Add-ons/salsa.avif', 'assets/img/Add-ons/salsa.avif', 'foods', 'add_ons', true, true, false, false, false, 'none', '{}'),
  ('Biscoff Burnt Cheesecake', 'biscoff-burnt-cheesecake', 'Cakes', 'Burnt cheesecake with rich biscoff flavor', 265.0, 'assets/img/Cakes/BurntBiscoffCheesecake.jpg', 'assets/img/Cakes/BurntBiscoffCheesecake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":265,"whole":2600},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Macadamia', 'macadamia-cookie', 'Cookies', 'Buttery cookie with crunchy macadamia nuts', 135.0, 'assets/img/Cookies/Macadamia.jpg', 'assets/img/Cookies/Macadamia.jpg', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Biscoff Latte', 'biscoff-latte', 'TCR Specials', 'Biscoff spread, milk, espresso shot, biscoff foam, biscoff cookie', 210.0, 'assets/img/TCR Specials/BiscoffLatte.png', 'assets/img/TCR Specials/BiscoffLatte.png', 'drinks', 'tcr_specials', true, true, true, true, true, 'iced_only', '{}'),
  ('Dark Mocha Latte', 'dark-mocha-latte', 'Espresso', 'Double shot espresso, milk, dark chocolate', 170.0, 'assets/img/Espresso/DarkMochaLatte.jpg', 'assets/img/Espresso/DarkMochaLatte.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Pink Milk', 'pink-milk', 'Non-Coffee', 'Thai drink, sala syrup, condensed and evaporated milk', 150.0, 'assets/img/Non-Coffee/PinkMilk.webp', 'assets/img/Non-Coffee/PinkMilk.webp', 'drinks', 'non_coffee', true, true, true, true, true, 'iced_only', '{}'),
  ('Chicken Tenders', 'chicken-tenders', 'Meals', 'Chicken tenders, melted cheese, scrambled egg', 185.0, 'assets/img/meals/ChickenTenders.jpg', 'assets/img/meals/ChickenTenders.jpg', 'foods', 'meals', true, true, false, false, false, 'none', '{}'),
  ('Carrot Walnut Cake', 'carrot-walnut-cake', 'Cakes', 'Moist carrot cake with crunchy walnuts', 245.0, 'assets/img/Cakes/CarrotWalnutCake.jpg', 'assets/img/Cakes/CarrotWalnutCake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":245,"whole":2400},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Matcha', 'matcha-cookie', 'Cookies', 'Soft cookie with earthy matcha taste', 145.0, 'assets/img/Cookies/MatchaCookie.png', 'assets/img/Cookies/MatchaCookie.png', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Americano', 'americano', 'Espresso', 'Double shot espresso, water', 145.0, 'assets/img/Espresso/Americano.jpg', 'assets/img/Espresso/Americano.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Strawberry Milk', 'strawberry-milk', 'Non-Coffee', 'Milk, strawberry pur?e, sweetener', 140.0, 'assets/img/Non-Coffee/StrawberryMilk.jpg', 'assets/img/Non-Coffee/StrawberryMilk.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'iced_only', '{}'),
  ('Red Velvet Cake', 'red-velvet-cake', 'Cakes', 'Classic red velvet with smooth cream cheese frosting', 245.0, 'assets/img/Cakes/RedVelvetCake.jpg', 'assets/img/Cakes/RedVelvetCake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":245,"whole":2400},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('S?mores', 'smores-cookie', 'Cookies', 'Chocolatey cookie with marshmallow filling', 100.0, 'assets/img/Cookies/S''mores.jpg', 'assets/img/Cookies/S''mores.jpg', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Latte', 'latte', 'Espresso', 'Double shot espresso, milk', 150.0, 'assets/img/Espresso/Latte.jpg', 'assets/img/Espresso/Latte.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Thai Milktea', 'thai-milktea', 'Non-Coffee', 'Thai tea leaves, condensed and evaporated milk', 150.0, 'assets/img/Non-Coffee/ThaiMilktea.jpg', 'assets/img/Non-Coffee/ThaiMilktea.jpg', 'drinks', 'non_coffee', true, true, true, true, true, 'iced_only', '{}'),
  ('Tiramisu', 'tiramisu', 'Cakes', 'Coffee-flavored layered cake with creamy filling', 310.0, 'assets/img/Cakes/TiramisuCake.jpg', 'assets/img/Cakes/TiramisuCake.jpg', 'foods', 'cakes', true, true, false, false, false, 'none', '{"type":"cake","prices":{"slice":310,"whole":2700},"labels":{"slice":"Slice","whole":"Whole"}}'),
  ('Walnut', 'walnut-cookie', 'Cookies', 'Nutty cookie with crunchy walnut bits', 135.0, 'assets/img/Cookies/Walnut.jpg', 'assets/img/Cookies/Walnut.jpg', 'foods', 'cookies', true, true, false, false, false, 'none', '{}'),
  ('Cappuccino', 'cappuccino', 'Espresso', 'Double shot espresso, milk, milk foam', 150.0, 'assets/img/Espresso/Cappuccino.jpg', 'assets/img/Espresso/Cappuccino.jpg', 'drinks', 'espresso', true, true, true, true, true, 'flexible', '{}'),
  ('Sampler Box of 6', 'sampler-box-of-6', 'Cookies', 'Mixed cookie flavors for variety', 735.0, 'assets/img/Cookies/SamplerBox6.JPG', 'assets/img/Cookies/SamplerBox6.JPG', 'foods', 'cookies', true, true, false, false, false, 'none', '{}')
) as seed(name, slug, category_name, description, price, image_url, image_path, main_category, subcategory, is_available, is_active, allow_addons, allow_sugar, allow_ice, temperature_type, variant_config)
join public.categories c on c.slug = lower(regexp_replace(seed.category_name, '[^a-zA-Z0-9]+', '-', 'g'))
on conflict (slug) do update set
  category_id = excluded.category_id,
  category_name = excluded.category_name,
  description = excluded.description,
  price = excluded.price,
  image_url = excluded.image_url,
  image_path = excluded.image_path,
  main_category = excluded.main_category,
  subcategory = excluded.subcategory,
  is_available = excluded.is_available,
  is_active = excluded.is_active,
  allow_addons = excluded.allow_addons,
  allow_sugar = excluded.allow_sugar,
  allow_ice = excluded.allow_ice,
  temperature_type = excluded.temperature_type,
  variant_config = excluded.variant_config,
  updated_at = now();

create table if not exists public.product_addons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price numeric(12,2) not null default 0,
  applies_to text not null default 'drink',
  target_temperature text not null default 'both',
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.product_addons enable row level security;
drop policy if exists "cashier read product addons" on public.product_addons;
create policy "cashier read product addons" on public.product_addons for select using (is_available = true);

insert into public.product_addons (name, price, applies_to, target_temperature, is_available, sort_order) values
  ('Espresso shot', 30.0, 'drink', 'both', true, 1),
  ('Oat milk', 20.0, 'drink', 'both', true, 2),
  ('Whipped cream', 15.0, 'drink', 'both', true, 3),
  ('Seasalt cream', 15.0, 'drink', 'iced', true, 4),
  ('Sauce / Syrup', 15.0, 'drink', 'both', true, 5)
on conflict (name) do update set
  price = excluded.price,
  applies_to = excluded.applies_to,
  target_temperature = excluded.target_temperature,
  is_available = excluded.is_available,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Seeded 9 categories, 58 active/non-archived menu products, and 5 add-ons from the old dump.