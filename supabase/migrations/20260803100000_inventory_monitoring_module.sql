-- Admin Inventory Monitoring is a read-only oversight page — it does not add
-- any new write path (editing/adjusting stock stays exclusively in the
-- Operations Staff Inventory Management page and its existing RPCs). This
-- migration only adds the columns that monitoring needs but don't exist yet:
-- a cost basis for computing inventory value, an optional expiration date,
-- and an optional SKU/reference code. All nullable — until something writes
-- them, Inventory Value / Expiring Soon simply report "not tracked" instead
-- of fabricating a number.
--
-- No RLS changes: is_staff_profile() already includes 'admin', so the
-- existing "Staff read ingredients/supplies/finished products" policies from
-- 20260731100000_inventory_stock_overview.sql already cover this page.

alter table public.ingredients
  add column if not exists cost_per_unit numeric check (cost_per_unit is null or cost_per_unit >= 0),
  add column if not exists expiration_date date,
  add column if not exists sku text;

alter table public.finished_products
  add column if not exists cost_per_unit numeric check (cost_per_unit is null or cost_per_unit >= 0),
  add column if not exists expiration_date date,
  add column if not exists sku text;

alter table public.supplies
  add column if not exists cost_per_unit numeric check (cost_per_unit is null or cost_per_unit >= 0),
  add column if not exists expiration_date date,
  add column if not exists sku text;

notify pgrst,'reload schema';
