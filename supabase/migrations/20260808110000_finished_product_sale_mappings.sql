-- A single finished-product stock record can be sold through multiple menu
-- formats. Example: Cookie stock is kept in pieces, while the menu can sell
-- one piece (1 inventory unit) or a box (6 inventory units).
create table if not exists public.finished_product_sale_mappings (
  id uuid primary key default gen_random_uuid(),
  finished_product_id uuid not null references public.finished_products(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  variant_key text,
  units_per_sale numeric not null check (units_per_sale > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists finished_product_sale_mappings_unique
  on public.finished_product_sale_mappings (finished_product_id, menu_item_id, coalesce(variant_key, ''));

-- Preserve the original one-menu-item link as a default one-unit mapping.
insert into public.finished_product_sale_mappings (finished_product_id, menu_item_id, units_per_sale)
select id, menu_item_id, 1
from public.finished_products
where menu_item_id is not null
on conflict (finished_product_id, menu_item_id, coalesce(variant_key, '')) do nothing;

alter table public.finished_product_sale_mappings enable row level security;
drop policy if exists "Staff read finished product sale mappings" on public.finished_product_sale_mappings;
create policy "Staff read finished product sale mappings" on public.finished_product_sale_mappings
  for select to authenticated using (public.is_staff_profile());

create or replace function public.staff_set_finished_product_sale_mappings(
  p_finished_product_id uuid, p_mappings jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_mapping jsonb;
begin
  perform public.assert_inventory_writer();
  if not exists (select 1 from public.finished_products where id = p_finished_product_id and not is_archived) then
    raise exception 'Product not found';
  end if;

  delete from public.finished_product_sale_mappings where finished_product_id = p_finished_product_id;
  for v_mapping in select * from jsonb_array_elements(coalesce(p_mappings, '[]'::jsonb)) loop
    if nullif(btrim(v_mapping->>'menu_item_id'), '') is null then
      raise exception 'A linked menu item is required for every product sale mapping';
    end if;
    if coalesce((v_mapping->>'units_per_sale')::numeric, 0) <= 0 then
      raise exception 'Units per sale must be greater than zero';
    end if;
    insert into public.finished_product_sale_mappings (finished_product_id, menu_item_id, variant_key, units_per_sale)
    values (
      p_finished_product_id,
      (v_mapping->>'menu_item_id')::uuid,
      nullif(btrim(coalesce(v_mapping->>'variant_key', '')), ''),
      (v_mapping->>'units_per_sale')::numeric
    );
  end loop;
end;
$$;

revoke all on function public.staff_set_finished_product_sale_mappings(uuid,jsonb) from public;
grant execute on function public.staff_set_finished_product_sale_mappings(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
