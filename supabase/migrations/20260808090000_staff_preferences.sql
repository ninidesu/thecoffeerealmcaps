-- Personal presentation and notification settings for Operations Staff.
-- These settings never control shared store configuration or permissions.
create table if not exists public.staff_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  landing_view text not null default 'orders' check (landing_view in ('orders','inventory','transactions','menu')),
  order_queue text not null default 'active' check (order_queue in ('active','scheduled')),
  order_sort text not null default 'priority' check (order_sort in ('priority','oldest','newest','scheduled')),
  fulfillment_filter text not null default 'all' check (fulfillment_filter in ('all','pickup','delivery')),
  overdue_highlighting boolean not null default true,
  inventory_tab text not null default 'ingredient' check (inventory_tab in ('ingredient','finished_product','supply')),
  inventory_filter text not null default 'all' check (inventory_filter in ('all','low','out')),
  table_density text not null default 'comfortable' check (table_density in ('comfortable','compact')),
  rows_per_page integer not null default 25 check (rows_per_page in (10,25,50)),
  remember_filters boolean not null default true,
  reduced_motion text not null default 'system' check (reduced_motion in ('system','reduce','full')),
  high_contrast boolean not null default false,
  font_size text not null default 'standard' check (font_size in ('standard','large')),
  notify_new_orders boolean not null default true,
  notify_payment_proofs boolean not null default true,
  notify_low_stock boolean not null default true,
  notify_menu_changes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_preferences enable row level security;

drop policy if exists "Staff read own preferences" on public.staff_preferences;
create policy "Staff read own preferences" on public.staff_preferences for select to authenticated
  using (user_id = auth.uid() and public.is_staff_profile());

drop policy if exists "Staff create own preferences" on public.staff_preferences;
create policy "Staff create own preferences" on public.staff_preferences for insert to authenticated
  with check (user_id = auth.uid() and public.is_staff_profile());

drop policy if exists "Staff update own preferences" on public.staff_preferences;
create policy "Staff update own preferences" on public.staff_preferences for update to authenticated
  using (user_id = auth.uid() and public.is_staff_profile())
  with check (user_id = auth.uid() and public.is_staff_profile());

notify pgrst, 'reload schema';
