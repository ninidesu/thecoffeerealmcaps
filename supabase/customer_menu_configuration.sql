-- Customer menu configuration aligned with the legacy catalog rules.
-- Review and run in the Supabase SQL editor. Safe to run more than once.

update public.menu_items set variant_options = jsonb_build_object(
 'type','cake','prices',jsonb_build_object('slice',price,'whole',case slug
  when 'blueberry-cheesecake' then 1900 when 'matcha-cheesecake' then 2100
  when 'leche-flan-cheesecake' then 2400 when 'basque-burnt-cheesecake' then 2200
  when 'biscoff-burnt-cheesecake' then 2600 when 'carrot-walnut-cake' then 2400
  when 'red-velvet-cake' then 2400 when 'tiramisu' then 2700 end),
 'labels',jsonb_build_object('slice','Slice','whole','Whole'))
where slug in ('blueberry-cheesecake','matcha-cheesecake','leche-flan-cheesecake','basque-burnt-cheesecake','biscoff-burnt-cheesecake','carrot-walnut-cake','red-velvet-cake','tiramisu');

update public.menu_items set variant_options='{"type":"cookie_box","prices":{"box3":365,"box6":750},"labels":{"box3":"Box of 3","box6":"Box of 6"}}'::jsonb where slug='bestseller-box';
update public.menu_items set allow_addons=true where subcategory_id in (select id from public.subcategories where name='meals');

with seed(name,price,applies_to,target_temperature,is_available,sort_order) as (values
 ('Plain Rice',25::numeric,'food','both',true,10),('Scrambled Egg',20::numeric,'food','both',true,11),
 ('Sunny Side Up Egg',20::numeric,'food','both',true,12),('Cheese Sauce',30::numeric,'food','both',true,13),
 ('Salsa',30::numeric,'food','both',true,14))
insert into public.addons(name,price,applies_to,target_temperature,is_available,sort_order)
select * from seed where not exists(select 1 from public.addons a where lower(a.name)=lower(seed.name));

with seed(name,price,sort_order) as (values ('Plain Rice',25::numeric,10),('Scrambled Egg',20::numeric,11),('Sunny Side Up Egg',20::numeric,12),('Cheese Sauce',30::numeric,13),('Salsa',30::numeric,14))
update public.addons a set price=seed.price,applies_to='food',target_temperature='both',is_available=true,sort_order=seed.sort_order from seed where lower(a.name)=lower(seed.name);
