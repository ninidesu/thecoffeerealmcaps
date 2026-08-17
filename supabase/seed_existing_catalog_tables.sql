-- CANONICAL APPLICATION CATALOG SEED
-- The React customer and cashier experiences both read public.menu_items.
--
-- Seed existing UUID-based Supabase catalog tables from coffee_pos.sql
-- No ON CONFLICT required. This works even when the tables have no unique constraints.
-- It skips rows that already exist by natural keys: category name, subcategory name, menu slug, addon name.

insert into public.main_categories (name, display_name, sort_order, is_active)
select seed.name, seed.display_name, seed.sort_order, seed.is_active
from (values
  ('drinks', 'Drinks', 1, true),
  ('foods', 'Foods', 2, true)
) as seed(name, display_name, sort_order, is_active)
where not exists (select 1 from public.main_categories existing where existing.name = seed.name);

insert into public.subcategories (main_category_id, name, display_name, sort_order, is_active)
select mc.id, seed.name, seed.display_name, seed.sort_order, seed.is_active
from (values
  ('drinks', 'tcr_specials', 'TCR Specials', 1, true),
  ('drinks', 'espresso', 'Espresso', 2, true),
  ('drinks', 'non_coffee', 'Non-Coffee', 3, true),
  ('foods', 'meals', 'Meals', 1, true),
  ('foods', 'snacks', 'Snacks', 6, true),
  ('foods', 'pasta', 'Pasta', 4, true),
  ('foods', 'add_ons', 'Add Ons', 5, true),
  ('foods', 'cakes', 'Cakes', 3, true),
  ('foods', 'cookies', 'Cookies', 2, true)
) as seed(main_category_name, name, display_name, sort_order, is_active)
join public.main_categories mc on mc.name = seed.main_category_name
where not exists (
  select 1 from public.subcategories existing
  where existing.main_category_id = mc.id and existing.name = seed.name
);

insert into public.menu_items (main_category_id, subcategory_id, item_type, name, slug, description, price, temperature_type, allow_addons, allow_sugar, allow_ice, image_url, is_available, is_archived, sort_order)
select mc.id, sc.id, seed.item_type, seed.name, seed.slug, seed.description, seed.price, seed.temperature_type, seed.allow_addons, seed.allow_sugar, seed.allow_ice, seed.image_url, seed.is_available, seed.is_archived, seed.sort_order
from (values
  ('drinks', 'tcr_specials', 'drink', 'Earl Grey Oat Matcha Latte', 'earl-grey-oat-matcha-latte', 'Ceremonial grade matcha, oat milk, earl grey syrup', 185.0, 'iced_only', true, true, true, 'assets/img/TCR Specials/EarlGreyOatMatchaLatte.jpg', true, false, 1),
  ('drinks', 'tcr_specials', 'drink', 'Hojicha Coconut Cloud', 'hojicha-coconut-cloud', 'Hojicha powder, coconut water, cream, sweetener', 175.0, 'iced_only', true, true, true, 'assets/img/TCR Specials/HojichaCoconutCloud.png', true, false, 2),
  ('drinks', 'tcr_specials', 'drink', 'Taho Latte', 'taho-latte', 'Soy milk, sago, arnibal', 170.0, 'iced_only', true, true, true, 'assets/img/TCR Specials/TahoLatte.jpg', false, false, 3),
  ('drinks', 'tcr_specials', 'drink', 'Black Sesame Matcha Latte', 'black-sesame-matcha-latte', 'Ceremonial grade matcha, milk, black sesame foam', 175.0, 'iced_only', true, true, true, 'assets/img/TCR Specials/BlackSesameMatchaLatte.jpg', true, false, 4),
  ('drinks', 'tcr_specials', 'drink', 'Passion Fruit Yuzu Black Tea', 'passion-fruit-yuzu-black-tea', 'Passion fruit pure, yuzu syrup, black tea', 150.0, 'iced_only', true, true, true, 'assets/img/TCR Specials/PassionFruitYuzuBlackTea.jpg', true, false, 5),
  ('drinks', 'tcr_specials', 'drink', 'Biscoff Latte', 'biscoff-latte', 'Biscoff spread, milk, espresso shot, biscoff foam, biscoff cookie', 210.0, 'iced_only', true, true, true, 'assets/img/TCR Specials/BiscoffLatte.png', true, false, 6),
  ('drinks', 'espresso', 'drink', 'Maple Oat Latte', 'maple-oat-latte', 'Double shot espresso, milk, maple syrup, cinnamon', 185.0, 'flexible', true, true, true, 'assets/img/Espresso/MapleOatLatte.jpg', true, false, 1),
  ('drinks', 'espresso', 'drink', 'Spanish Latte', 'spanish-latte', 'Double shot espresso, milk, condensed milk', 160.0, 'flexible', true, true, true, 'assets/img/Espresso/SpanishLatte.jpg', true, false, 2),
  ('drinks', 'espresso', 'drink', 'Seasalt Latte', 'seasalt-latte', 'Double shot espresso, milk, seasalt cream', 175.0, 'iced_only', true, true, true, 'assets/img/Espresso/SeasaltLatte.jpg', true, false, 3),
  ('drinks', 'espresso', 'drink', 'White Mocha', 'white-mocha', 'Double shot espresso, milk, white chocolate, cream', 170.0, 'flexible', true, true, true, 'assets/img/Espresso/WhiteMocha.jpg', true, false, 4),
  ('drinks', 'espresso', 'drink', 'Caramel Latte', 'caramel-latte', 'Double shot espresso, milk, caramel syrup and sauce', 170.0, 'flexible', true, true, true, 'assets/img/Espresso/CaramelLatte.jpg', true, false, 5),
  ('drinks', 'espresso', 'drink', 'Dark Mocha Latte', 'dark-mocha-latte', 'Double shot espresso, milk, dark chocolate', 170.0, 'flexible', true, true, true, 'assets/img/Espresso/DarkMochaLatte.jpg', true, false, 6),
  ('drinks', 'espresso', 'drink', 'Americano', 'americano', 'Double shot espresso, water', 145.0, 'flexible', true, true, true, 'assets/img/Espresso/Americano.jpg', true, false, 7),
  ('drinks', 'espresso', 'drink', 'Latte', 'latte', 'Double shot espresso, milk', 150.0, 'flexible', true, true, true, 'assets/img/Espresso/Latte.jpg', true, false, 8),
  ('drinks', 'espresso', 'drink', 'Cappuccino', 'cappuccino', 'Double shot espresso, milk, milk foam', 150.0, 'flexible', true, true, true, 'assets/img/Espresso/Cappuccino.jpg', true, false, 9),
  ('drinks', 'non_coffee', 'drink', 'Matcha Latte', 'matcha-latte', 'Ceremonial grade matcha, milk', 150.0, 'flexible', true, true, true, 'assets/img/Non-Coffee/MatchaLatte.jpg', true, false, 1),
  ('drinks', 'non_coffee', 'drink', 'Dark/White Chocolate', 'dark-white-chocolate', 'Milk, dark or white chocolate, cream, mallows', 140.0, 'flexible', true, true, true, 'assets/img/Non-Coffee/DarkChocolate.jpg', true, false, 2),
  ('drinks', 'non_coffee', 'drink', 'Lychee Fruit Tea', 'lychee-fruit-tea', 'Black tea, lychee syrup, sweetener', 110.0, 'flexible', true, true, true, 'assets/img/Non-Coffee/LycheeFruitTea.jpg', true, false, 3),
  ('drinks', 'non_coffee', 'drink', 'Lemon Fruit Tea', 'lemon-fruit-tea', 'Black tea, lemon syrup, sweetener', 110.0, 'flexible', true, true, true, 'assets/img/Non-Coffee/LemonFruitTea.jpg', true, false, 4),
  ('drinks', 'non_coffee', 'drink', 'Iced Shaken Honey Citron Tea', 'iced-shaken-honey-citron-tea', 'Shaken black tea, honey citron, sweetener', 150.0, 'iced_only', true, true, true, 'assets/img/Non-Coffee/IcedShakenHoneyCitron.jpg', true, false, 5),
  ('drinks', 'non_coffee', 'drink', 'Pink Milk', 'pink-milk', 'Thai drink, sala syrup, condensed and evaporated milk', 150.0, 'iced_only', true, true, true, 'assets/img/Non-Coffee/PinkMilk.webp', true, false, 6),
  ('drinks', 'non_coffee', 'drink', 'Strawberry Milk', 'strawberry-milk', 'Milk, strawberry pure, sweetener', 140.0, 'iced_only', true, true, true, 'assets/img/Non-Coffee/StrawberryMilk.jpg', true, false, 7),
  ('drinks', 'non_coffee', 'drink', 'Thai Milktea', 'thai-milktea', 'Thai tea leaves, condensed and evaporated milk', 150.0, 'iced_only', true, true, true, 'assets/img/Non-Coffee/ThaiMilktea.jpg', true, false, 8),
  ('foods', 'meals', 'food', 'Beef Tapa', 'beef-tapa', 'Plain rice, classic beef tapa, fried egg', 175.0, 'none', false, false, false, 'assets/img/meals/BeefTapa.jpg', true, false, 1),
  ('foods', 'meals', 'food', 'Bangus', 'bangus', 'Plain rice, marinated bangus, fried egg', 185.0, 'none', false, false, false, 'assets/img/meals/Bangus.jpg', true, false, 2),
  ('foods', 'meals', 'food', 'Katsu Curry', 'katsu-curry', 'Plain rice, crispy tonkatsu, Japanese curry sauce, potato, carrots', 195.0, 'none', false, false, false, 'assets/img/meals/KatsuCurry.jpg', true, false, 3),
  ('foods', 'meals', 'food', 'Corned Beef + Spam', 'corned-beef-spam', 'Plain rice, corned beef, spam, scrambled egg', 185.0, 'none', false, false, false, 'assets/img/meals/CornBeefSpam.jpg', true, false, 4),
  ('foods', 'meals', 'food', 'Hungarian', 'hungarian', 'Plain rice, cheesy and spicy Hungarian sausage, fried egg', 175.0, 'none', false, false, false, 'assets/img/meals/Hungarian.jpg', true, false, 5),
  ('foods', 'meals', 'food', 'Chicken Tenders', 'chicken-tenders', 'Chicken tenders, melted cheese, scrambled egg', 185.0, 'none', false, false, false, 'assets/img/meals/ChickenTenders.jpg', true, false, 6),
  ('foods', 'snacks', 'food', 'Nuggets', 'nuggets', 'Shoestring fries, crispy chicken nuggets with ketchup and cheese on the side', 225.0, 'none', false, false, false, 'assets/img/Snacks/Nuggets&Fries.jpg', true, false, 1),
  ('foods', 'snacks', 'food', 'Potato Wedges', 'potato-wedges', 'Seasoned crispy potato wedges with ketchup and mustard', 185.0, 'none', false, false, false, 'assets/img/Snacks/PotatoWedge.jpg', true, false, 2),
  ('foods', 'snacks', 'food', 'Classic Nachos', 'classic-nachos', 'Fried nacho chips, melted cheese, chunky salsa', 195.0, 'none', false, false, false, 'assets/img/Snacks/ClassicNachos.jpg', true, false, 3),
  ('foods', 'pasta', 'food', 'Alfredo', 'alfredo', 'Fettuccine pasta, toasted loaf, white sauce, chicken tenders', 240.0, 'none', false, false, false, 'assets/img/Pasta/Alfredo.jpg', true, false, 1),
  ('foods', 'pasta', 'food', 'Pesto', 'pesto', 'Penne pasta, toasted loaf, pesto sauce (basil and pine nuts)', 205.0, 'none', false, false, false, 'assets/img/Pasta/Pesto.png', true, false, 2),
  ('foods', 'pasta', 'food', 'Spicy Peanut', 'spicy-peanut', 'Knife-cut noodles, homemade chili peanut sauce', 205.0, 'none', false, false, false, 'assets/img/Pasta/SpicyPeanutNoodle.jpg', true, false, 3),
  ('foods', 'pasta', 'food', 'Mac and Cheese', 'mac-and-cheese', 'Macaroni pasta, toasted loaf, cheesy sauce', 195.0, 'none', false, false, false, 'assets/img/Pasta/Mac&Cheese.jpg', true, false, 4),
  ('foods', 'add_ons', 'food', 'Plain Rice', 'plain-rice', 'Extra plain rice', 25.0, 'none', false, false, false, 'assets/img/Add-ons/PlainRice.png', true, false, 1),
  ('foods', 'add_ons', 'food', 'Scrambled Egg', 'scrambled-egg', 'Extra scrambled egg', 20.0, 'none', false, false, false, 'assets/img/Add-ons/ScrambledEgg.png', true, false, 2),
  ('foods', 'add_ons', 'food', 'Sunny Side Up Egg', 'sunny-side-up-egg', 'Extra sunny side up egg', 20.0, 'none', false, false, false, 'assets/img/Add-ons/SunnySideUpEgg.png', true, false, 3),
  ('foods', 'add_ons', 'food', 'Cheese Sauce', 'cheese-sauce', 'Extra cheese sauce', 30.0, 'none', false, false, false, 'assets/img/Add-ons/cheesesauce.webp', true, false, 4),
  ('foods', 'add_ons', 'food', 'Salsa', 'salsa', 'Extra salsa', 30.0, 'none', false, false, false, 'assets/img/Add-ons/salsa.avif', true, false, 5),
  ('foods', 'cakes', 'food', 'Blueberry Cheesecake', 'blueberry-cheesecake', 'Creamy cheesecake topped with sweet blueberry compote', 245.0, 'none', false, false, false, 'assets/img/Cakes/BlueberryCheesecake.jpg', true, false, 1),
  ('foods', 'cakes', 'drink', 'Matcha Cheesecake', 'matcha-cheesecake', 'Smooth cheesecake infused with rich matcha flavor', 265.0, 'none', false, false, false, 'assets/img/Cakes/MatchaCheesecake.jpg', true, false, 2),
  ('foods', 'cakes', 'food', 'Leche Flan Cheesecake', 'leche-flan-cheesecake', 'Creamy cheesecake layered with caramelized leche flan', 245.0, 'none', false, false, false, 'assets/img/Cakes/LecheFlanCheesecake.jpg', true, false, 3),
  ('foods', 'cakes', 'food', 'Basque Burnt Cheesecake', 'basque-burnt-cheesecake', 'Soft, caramelized cheesecake with a burnt top', 225.0, 'none', false, false, false, 'assets/img/Cakes/BurntBasqueCheesecake.jpg', true, false, 4),
  ('foods', 'cakes', 'food', 'Biscoff Burnt Cheesecake', 'biscoff-burnt-cheesecake', 'Burnt cheesecake with rich biscoff flavor', 265.0, 'none', false, false, false, 'assets/img/Cakes/BurntBiscoffCheesecake.jpg', true, false, 5),
  ('foods', 'cakes', 'food', 'Carrot Walnut Cake', 'carrot-walnut-cake', 'Moist carrot cake with crunchy walnuts', 245.0, 'none', false, false, false, 'assets/img/Cakes/CarrotWalnutCake.jpg', true, false, 6),
  ('foods', 'cakes', 'food', 'Red Velvet Cake', 'red-velvet-cake', 'Classic red velvet with smooth cream cheese frosting', 245.0, 'none', false, false, false, 'assets/img/Cakes/RedVelvetCake.jpg', true, false, 7),
  ('foods', 'cakes', 'food', 'Tiramisu', 'tiramisu', 'Coffee-flavored layered cake with creamy filling', 310.0, 'none', false, false, false, 'assets/img/Cakes/TiramisuCake.jpg', true, false, 8),
  ('foods', 'cookies', 'food', 'Bestseller Box', 'bestseller-box', 'Assorted top-selling cookies in one box', 365.0, 'none', false, false, false, 'assets/img/Cookies/bestseller_box.JPG', true, false, 1),
  ('foods', 'cookies', 'drink', 'Chocolate Chip', 'chocolate-chip-cookie', 'Soft cookie loaded with rich chocolate chips', 125.0, 'none', false, false, false, 'assets/img/Cookies/ChocolateChip.webp', true, false, 2),
  ('foods', 'cookies', 'food', 'Red Velvet', 'red-velvet-cookie', 'Soft red velvet cookie with a creamy center', 135.0, 'none', false, false, false, 'assets/img/Cookies/RedVelvet.jpg', true, false, 3),
  ('foods', 'cookies', 'food', 'Biscoff', 'biscoff-cookie', 'Sweet cookie with rich biscoff flavor', 125.0, 'none', false, false, false, 'assets/img/Cookies/Biscoff.jpg', true, false, 4),
  ('foods', 'cookies', 'food', 'Macadamia', 'macadamia-cookie', 'Buttery cookie with crunchy macadamia nuts', 135.0, 'none', false, false, false, 'assets/img/Cookies/Macadamia.jpg', true, false, 5),
  ('foods', 'cookies', 'drink', 'Matcha', 'matcha-cookie', 'Soft cookie with earthy matcha taste', 145.0, 'none', false, false, false, 'assets/img/Cookies/MatchaCookie.png', true, false, 6),
  ('foods', 'cookies', 'food', 'Smores', 'smores-cookie', 'Chocolatey cookie with marshmallow filling', 100.0, 'none', false, false, false, 'assets/img/Cookies/S''mores.jpg', true, false, 7),
  ('foods', 'cookies', 'food', 'Walnut', 'walnut-cookie', 'Nutty cookie with crunchy walnut bits', 135.0, 'none', false, false, false, 'assets/img/Cookies/Walnut.jpg', true, false, 8),
  ('foods', 'cookies', 'food', 'Sampler Box of 6', 'sampler-box-of-6', 'Mixed cookie flavors for variety', 735.0, 'none', false, false, false, 'assets/img/Cookies/SamplerBox6.JPG', true, false, 9),
  ('foods', 'add_ons', 'food', 'N4G1', 'n4g1', 'masarap, pogi, yummy', 10000.0, 'none', false, false, false, 'staff/uploads/menu/n4g1-1776874922.jpg', false, true, 0)
) as seed(main_category_name, subcategory_name, item_type, name, slug, description, price, temperature_type, allow_addons, allow_sugar, allow_ice, image_url, is_available, is_archived, sort_order)
join public.main_categories mc on mc.name = seed.main_category_name
join public.subcategories sc on sc.main_category_id = mc.id and sc.name = seed.subcategory_name
where not exists (select 1 from public.menu_items existing where existing.slug = seed.slug);

insert into public.addons (name, price, applies_to, target_temperature, is_available, sort_order)
select seed.name, seed.price, seed.applies_to, seed.target_temperature, seed.is_available, seed.sort_order
from (values
  ('Espresso shot', 30.0, 'drink', 'both', true, 1),
  ('Oat milk', 20.0, 'drink', 'both', true, 2),
  ('Whipped cream', 15.0, 'drink', 'both', true, 3),
  ('Seasalt cream', 15.0, 'drink', 'iced', true, 4),
  ('Sauce / Syrup', 15.0, 'drink', 'both', true, 5)
) as seed(name, price, applies_to, target_temperature, is_available, sort_order)
where not exists (select 1 from public.addons existing where existing.name = seed.name);

-- Seeded up to 2 main categories, 9 subcategories, 59 menu items, and 5 add-ons.
