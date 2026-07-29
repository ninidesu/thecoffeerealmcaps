-- LEGACY COMPATIBILITY SCHEMA
-- The application catalog is public.menu_items with main_categories and
-- subcategories. The public.categories/public.products tables below are retained
-- only for older cashier deployments; do not seed both catalog models.
--

-- thecoffeerealm cashier-only Supabase setup
-- Run this in Supabase Dashboard > SQL Editor.
-- It creates the tables expected by the React cashier POS.

create extension if not exists pgcrypto;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text default '',
  price numeric(12,2) not null default 0,
  image_url text,
  image_path text,
  main_category text,
  subcategory text,
  category_name text,
  is_available boolean not null default true,
  is_active boolean not null default true,
  allow_addons boolean not null default false,
  allow_sugar boolean not null default false,
  allow_ice boolean not null default false,
  temperature_type text,
  variant_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  reference_code text unique,
  order_type text not null default 'Walk-in',
  shipping_method text not null default 'walk-in',
  status text not null default 'Ordered',
  customer_name text,
  full_name text,
  cashier_id uuid,
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  discount_type text,
  discount_customer_name text,
  discount_id_number text,
  discount_subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  final_total numeric(12,2) not null default 0,
  payment_method text,
  payment_status text not null default 'paid',
  payment_confirmed boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  name text,
  unit_price numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,
  quantity integer not null default 1,
  qty integer not null default 1,
  line_total numeric(12,2) not null default 0,
  addons jsonb not null default '[]'::jsonb,
  customizations jsonb not null default '{}'::jsonb,
  is_discounted boolean not null default false,
  discount_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null,
  amount_due numeric(12,2) not null default 0,
  amount_received numeric(12,2) not null default 0,
  change_amount numeric(12,2) not null default 0,
  reference_number text,
  account_number text,
  bank_name text,
  status text not null default 'paid',
  paid_at timestamptz not null default now(),
  cashier_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_active_idx on public.products(is_active, is_available);
create index if not exists orders_type_created_idx on public.orders(order_type, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists payments_order_idx on public.payments(order_id);

insert into public.categories (name, slug, sort_order) values
  ('Espresso', 'espresso', 10),
  ('TCR Specials', 'tcr-specials', 20),
  ('Non-Coffee', 'non-coffee', 30),
  ('Meals', 'meals', 40),
  ('Cookies', 'cookies', 50),
  ('Cakes', 'cakes', 60),
  ('Pasta', 'pasta', 70),
  ('Snacks', 'snacks', 80)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.products (name, slug, category_id, category_name, description, price, image_url, is_available, main_category)
select seed.name, seed.slug, c.id, seed.category, seed.description, seed.price, seed.image_url, seed.is_available, seed.main_category
from (values
  ('Espresso Blend', 'espresso-blend', 'Espresso', 'Bold, rich, and perfect for full-bodied espresso shots.', 155.00, '/images/espressoblend.jpg', true, 'drinks'),
  ('Iced Americano', 'iced-americano', 'Espresso', 'Balanced chocolate notes ideal for daily sipping.', 145.00, '/images/iceamericano.jpg', true, 'drinks'),
  ('Machiato', 'machiato', 'Espresso', 'Silky smooth concentrate brewed low and slow.', 170.00, '/images/machiato.jpg', true, 'drinks'),
  ('Biscoff Latte', 'biscoff-latte', 'TCR Specials', '', 0.00, '/images/menu/BiscoffLatte.png', false, 'drinks'),
  ('Black Sesame Matcha Latte', 'black-sesame-matcha-latte', 'TCR Specials', '', 0.00, '/images/menu/BlackSesameMatchaLatte.jpg', false, 'drinks'),
  ('Hojicha Coconut Cloud', 'hojicha-coconut-cloud', 'TCR Specials', '', 0.00, '/images/menu/HojichaCoconutCloud.png', false, 'drinks'),
  ('Taho Latte', 'taho-latte', 'TCR Specials', '', 0.00, '/images/menu/TahoLatte.jpg', false, 'drinks'),
  ('Spanish Latte', 'spanish-latte', 'Espresso', '', 0.00, '/images/menu/SpanishLatte.jpg', false, 'drinks'),
  ('Sea Salt Latte', 'sea-salt-latte', 'Espresso', '', 0.00, '/images/menu/SeasaltLatte.jpg', false, 'drinks'),
  ('Matcha Latte', 'matcha-latte', 'Non-Coffee', '', 0.00, '/images/menu/MatchaLatte.jpg', false, 'drinks'),
  ('Thai Milk Tea', 'thai-milk-tea', 'Non-Coffee', '', 0.00, '/images/menu/ThaiMilktea.jpg', false, 'drinks'),
  ('Strawberry Milk', 'strawberry-milk', 'Non-Coffee', '', 0.00, '/images/menu/StrawberryMilk.jpg', false, 'drinks'),
  ('Beef Tapa', 'beef-tapa', 'Meals', '', 0.00, '/images/menu/BeefTapa.jpg', false, 'foods'),
  ('Katsu Curry', 'katsu-curry', 'Meals', '', 0.00, '/images/menu/KatsuCurry.jpg', false, 'foods'),
  ('Sampler Box 6', 'sampler-box-6', 'Cookies', '', 0.00, '/images/sampler_box_6.JPG', false, 'foods'),
  ('Burnt Basque Cheesecake', 'burnt-basque-cheesecake', 'Cakes', '', 0.00, '/images/menu/BurntBasqueCheesecake.jpg', false, 'foods'),
  ('Pesto', 'pesto', 'Pasta', '', 0.00, '/images/menu/Pesto.png', false, 'foods'),
  ('Classic Nachos', 'classic-nachos', 'Snacks', '', 0.00, '/images/menu/ClassicNachos.jpg', false, 'foods')
) as seed(name, slug, category, description, price, image_url, is_available, main_category)
join public.categories c on c.slug = lower(regexp_replace(seed.category, '[^a-zA-Z0-9]+', '-', 'g'))
on conflict (slug) do update set
  category_id = excluded.category_id,
  category_name = excluded.category_name,
  description = excluded.description,
  image_url = excluded.image_url,
  main_category = excluded.main_category;

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

drop policy if exists "cashier read categories" on public.categories;
create policy "cashier read categories" on public.categories for select using (true);

drop policy if exists "cashier read products" on public.products;
create policy "cashier read products" on public.products for select using (is_active = true);

drop policy if exists "cashier read orders" on public.orders;
create policy "cashier read orders" on public.orders for select using (order_type = 'Walk-in');

drop policy if exists "cashier insert walkin orders" on public.orders;
create policy "cashier insert walkin orders" on public.orders for insert with check (order_type = 'Walk-in' and shipping_method = 'walk-in');

drop policy if exists "cashier read order items" on public.order_items;
create policy "cashier read order items" on public.order_items for select using (true);

drop policy if exists "cashier insert order items" on public.order_items;
create policy "cashier insert order items" on public.order_items for insert with check (true);

drop policy if exists "cashier read payments" on public.payments;
create policy "cashier read payments" on public.payments for select using (true);

drop policy if exists "cashier insert payments" on public.payments;
create policy "cashier insert payments" on public.payments for insert with check (true);
