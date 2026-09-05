-- Availability is an operational status change. Staff can confirm and apply
-- it immediately; all other menu/content changes remain approval controlled.

create or replace function public.assert_menu_availability_writer()
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid() and removed_at is null;
  if coalesce(public.normalize_role(v_role), '') not in ('admin','staff','operational_staff') then
    raise exception 'Staff access required';
  end if;
end;
$$;

create or replace function public.staff_set_menu_item_availability(p_id uuid, p_manual_available boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_menu_availability_writer();
  update public.menu_items
  set manual_available = p_manual_available, updated_at = now()
  where id = p_id and not is_archived;
  if not found then raise exception 'Menu item not found'; end if;
  perform public.recompute_menu_item_availability(p_id);
end;
$$;

revoke all on function public.assert_menu_availability_writer() from public;
grant execute on function public.assert_menu_availability_writer() to authenticated;
revoke all on function public.staff_set_menu_item_availability(uuid,boolean) from public;
grant execute on function public.staff_set_menu_item_availability(uuid,boolean) to authenticated;

-- Clear stale availability requests created before this exception was added.
-- The prior archiving migration already restores items held only for these
-- requests. Resolved historical rows stay available to the database audit,
-- but are filtered from the admin content-approval queue by the client.
delete from public.menu_change_approvals
where state = 'pending'
  and operation in ('set_availability', 'bulk_availability');

create or replace function public.staff_create_menu_approval(
  p_action text, p_item_name text, p_summary text, p_change_types text[], p_operation text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_item_id uuid;
  v_was_archived boolean;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_slug text;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and public.normalize_role(role) in ('admin','staff','operational_staff')
      and removed_at is null
  ) then
    raise exception 'Staff access required';
  end if;

  if p_action not in ('add','change','remove') or btrim(coalesce(p_item_name,'')) = '' then
    raise exception 'Invalid menu approval request';
  end if;
  if p_operation not in ('upsert_menu_item','archive_menu_item','duplicate_menu_item','upsert_main_category','upsert_subcategory','archive_main_category','archive_subcategory') then
    raise exception 'Unsupported menu approval operation';
  end if;

  -- A new item has no row to archive yet. Create its requested values as an
  -- archived placeholder, then store its generated id in the approval
  -- payload. Admin approval restores and applies the same row; rejection
  -- leaves the placeholder archived for staff review.
  if p_operation = 'upsert_menu_item'
     and p_action = 'add'
     and nullif(v_payload->>'id', '') is null then
    if btrim(coalesce(v_payload->>'name', '')) = '' then
      raise exception 'Item name is required';
    end if;
    if coalesce((v_payload->>'price')::numeric, -1) < 0 then
      raise exception 'Price cannot be negative';
    end if;

    v_slug := nullif(btrim(coalesce(v_payload->>'slug', '')), '');
    if v_slug is null then
      v_slug := trim(both '-' from lower(regexp_replace(btrim(v_payload->>'name'), '[^a-zA-Z0-9]+', '-', 'g')));
      if v_slug = '' then
        v_slug := 'menu-item-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
      end if;
    end if;

    insert into public.menu_items (
      main_category_id, subcategory_id, name, slug, description, price, item_type, temperature_type,
      allow_ice, allow_sugar, allow_addons, image_url, manual_available, is_available, is_featured, is_bestseller,
      prep_time_minutes, available_from, available_until, sort_order, variant_options, is_archived
    ) values (
      nullif(v_payload->>'mainCategoryId', '')::uuid,
      nullif(v_payload->>'subcategoryId', '')::uuid,
      btrim(v_payload->>'name'), v_slug, nullif(btrim(coalesce(v_payload->>'description', '')), ''),
      (v_payload->>'price')::numeric, coalesce(v_payload->>'itemType', 'food'), coalesce(v_payload->>'temperatureType', 'none'),
      coalesce((v_payload->>'allowIce')::boolean, false), coalesce((v_payload->>'allowSugar')::boolean, false),
      coalesce((v_payload->>'allowAddons')::boolean, false), nullif(btrim(coalesce(v_payload->>'imageUrl', '')), ''),
      coalesce((v_payload->>'manualAvailable')::boolean, true), false,
      coalesce((v_payload->>'isFeatured')::boolean, false), coalesce((v_payload->>'isBestseller')::boolean, false),
      nullif(v_payload->>'prepTimeMinutes', '')::integer, nullif(v_payload->>'availableFrom', '')::date,
      nullif(v_payload->>'availableUntil', '')::date, coalesce((v_payload->>'sortOrder')::integer, 0),
      coalesce(v_payload->'variantOptions', '{}'::jsonb), true
    ) returning id into v_item_id;

    v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_item_id::text), true);
    v_was_archived := true;
  elsif p_operation in ('upsert_menu_item','archive_menu_item') then
    v_item_id := nullif(v_payload->>'id', '')::uuid;
    if v_item_id is not null then
      select is_archived into v_was_archived
      from public.menu_items
      where id = v_item_id
      for update;
      if not found then raise exception 'Menu item not found'; end if;
      update public.menu_items set is_archived = true, updated_at = now() where id = v_item_id;
    end if;
  end if;

  insert into public.menu_change_approvals(
    submitted_by, action, item_name, summary, change_types, operation, payload, held_item_id, held_item_was_archived
  ) values (
    auth.uid(), p_action, left(btrim(p_item_name), 120), left(btrim(p_summary), 500), coalesce(p_change_types, '{}'),
    p_operation, v_payload, v_item_id, v_was_archived
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_decide_menu_approval(p_id uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
declare v_request public.menu_change_approvals%rowtype;
begin
  if not public.is_admin_profile() then raise exception 'Administrator access required'; end if;
  if p_state not in ('approved','rejected') then raise exception 'Invalid approval decision'; end if;
  select * into v_request from public.menu_change_approvals where id = p_id and state = 'pending' for update;
  if not found then raise exception 'Approval request not found or already decided'; end if;
  if v_request.operation in ('set_availability', 'bulk_availability') then
    raise exception 'Availability changes do not require admin approval';
  end if;

  if p_state = 'approved' then
    if v_request.operation = 'upsert_menu_item' then
      perform public.staff_upsert_menu_item(nullif(v_request.payload->>'id','')::uuid, nullif(v_request.payload->>'mainCategoryId','')::uuid, nullif(v_request.payload->>'subcategoryId','')::uuid, v_request.payload->>'name', v_request.payload->>'slug', v_request.payload->>'description', (v_request.payload->>'price')::numeric, v_request.payload->>'itemType', v_request.payload->>'temperatureType', coalesce((v_request.payload->>'allowIce')::boolean,false), coalesce((v_request.payload->>'allowSugar')::boolean,false), coalesce((v_request.payload->>'allowAddons')::boolean,false), v_request.payload->>'imageUrl', coalesce((v_request.payload->>'manualAvailable')::boolean,true), coalesce((v_request.payload->>'isFeatured')::boolean,false), coalesce((v_request.payload->>'isBestseller')::boolean,false), nullif(v_request.payload->>'prepTimeMinutes','')::integer, nullif(v_request.payload->>'availableFrom','')::date, nullif(v_request.payload->>'availableUntil','')::date, coalesce((v_request.payload->>'sortOrder')::integer,0), coalesce(v_request.payload->'variantOptions','{}'::jsonb));
    elsif v_request.operation = 'archive_menu_item' then
      perform public.staff_archive_menu_item((v_request.payload->>'id')::uuid);
    elsif v_request.operation = 'duplicate_menu_item' then
      perform public.staff_duplicate_menu_item((v_request.payload->>'id')::uuid);
    elsif v_request.operation = 'upsert_main_category' then
      perform public.staff_upsert_main_category(nullif(v_request.payload->>'id','')::uuid, v_request.payload->>'name', v_request.payload->>'displayName', coalesce((v_request.payload->>'sortOrder')::integer,0));
    elsif v_request.operation = 'upsert_subcategory' then
      perform public.staff_upsert_subcategory(nullif(v_request.payload->>'id','')::uuid, nullif(v_request.payload->>'mainCategoryId','')::uuid, v_request.payload->>'name', v_request.payload->>'displayName', coalesce((v_request.payload->>'sortOrder')::integer,0));
    elsif v_request.operation = 'archive_main_category' then
      perform public.staff_archive_main_category((v_request.payload->>'id')::uuid);
    elsif v_request.operation = 'archive_subcategory' then
      perform public.staff_archive_subcategory((v_request.payload->>'id')::uuid);
    else
      raise exception 'Unsupported menu approval operation';
    end if;
  end if;

  if v_request.held_item_id is not null and ((p_state = 'rejected' and coalesce(v_request.held_item_was_archived, false) = false) or (p_state = 'approved' and v_request.action <> 'remove')) then
    update public.menu_items set is_archived = false, updated_at = now() where id = v_request.held_item_id;
  end if;
  update public.menu_change_approvals set state = p_state, reviewed_by = auth.uid(), decided_at = now() where id = p_id;
end;
$$;

revoke all on function public.staff_create_menu_approval(text,text,text,text[],text,jsonb) from public;
revoke all on function public.admin_decide_menu_approval(uuid,text) from public;
grant execute on function public.staff_create_menu_approval(text,text,text,text[],text,jsonb) to authenticated;
grant execute on function public.admin_decide_menu_approval(uuid,text) to authenticated;
