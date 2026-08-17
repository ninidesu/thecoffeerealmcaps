update public.menu_items
set image_url = case slug
  when 'scrambled-egg' then 'assets/img/Add-ons/ScrambledEgg.png'
  when 'sunny-side-up-egg' then 'assets/img/Add-ons/SunnySideUpEgg.png'
  when 'plain-rice' then 'assets/img/Add-ons/PlainRice.png'
  else image_url
end,
updated_at = now()
where slug in ('scrambled-egg', 'sunny-side-up-egg', 'plain-rice');

do $$
begin
  if to_regclass('public.products') is not null then
    execute $update_products$
      update public.products
      set image_url = case slug
            when 'scrambled-egg' then 'assets/img/Add-ons/ScrambledEgg.png'
            when 'sunny-side-up-egg' then 'assets/img/Add-ons/SunnySideUpEgg.png'
            when 'plain-rice' then 'assets/img/Add-ons/PlainRice.png'
            else image_url
          end,
          image_path = case slug
            when 'scrambled-egg' then 'assets/img/Add-ons/ScrambledEgg.png'
            when 'sunny-side-up-egg' then 'assets/img/Add-ons/SunnySideUpEgg.png'
            when 'plain-rice' then 'assets/img/Add-ons/PlainRice.png'
            else image_path
          end
      where slug in ('scrambled-egg', 'sunny-side-up-egg', 'plain-rice')
    $update_products$;
  end if;
end
$$;

notify pgrst, 'reload schema';
