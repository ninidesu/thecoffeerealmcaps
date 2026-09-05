-- Eligibility is opt-in and only changes after administrator approval.
alter table public.menu_items add column online_benefit_eligible boolean not null default false;

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
  if p_operation not in ('set_online_benefit_eligibility','upsert_menu_item','archive_menu_item','duplicate_menu_item','upsert_main_category','upsert_subcategory','archive_main_category','archive_subcategory') then
    raise exception 'Unsupported menu approval operation';
  end if;

  if v_payload ? 'onlineBenefitEligible' and jsonb_typeof(v_payload->'onlineBenefitEligible') <> 'boolean' then
    raise exception 'Discount eligibility must be on or off';
  end if;
  if p_operation = 'set_online_benefit_eligibility' and
    (p_action <> 'change' or not (v_payload ? 'onlineBenefitEligible') or nullif(v_payload->>'id','') is null) then
    raise exception 'Choose an item and its discount eligibility';
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
  elsif p_operation in ('upsert_menu_item','archive_menu_item','set_online_benefit_eligibility') then
    v_item_id := nullif(v_payload->>'id', '')::uuid;
    if v_item_id is not null then
      select is_archived into v_was_archived
      from public.menu_items
      where id = v_item_id
      for update;
      if not found then raise exception 'Menu item not found'; end if;
      if exists(select 1 from public.menu_change_approvals where held_item_id=v_item_id and state='pending') then
        raise exception 'This item already has a pending change request';
      end if;
      update public.menu_items set is_archived = true, updated_at = now() where id = v_item_id;
    end if;
  end if;

  insert into public.menu_change_approvals(
    submitted_by, action, item_name, summary, change_types, operation, payload, held_item_id, held_item_was_archived
  ) values (
    auth.uid(), p_action, left(btrim(p_item_name), 120), left(btrim(p_summary), 500), case when p_operation='set_online_benefit_eligibility' then array['Online SC/PWD discount eligibility'] else coalesce(p_change_types, '{}') end,
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
      if v_request.payload ? 'onlineBenefitEligible' then
        update public.menu_items set online_benefit_eligible=(v_request.payload->>'onlineBenefitEligible')::boolean, updated_at=now()
          where id=v_request.held_item_id;
      end if;
    elsif v_request.operation = 'set_online_benefit_eligibility' then
      update public.menu_items set online_benefit_eligible=(v_request.payload->>'onlineBenefitEligible')::boolean, updated_at=now()
        where id=v_request.held_item_id;
      if not found then raise exception 'Menu item not found'; end if;
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

-- Bulk requests are atomic. Each item remains independently reviewable.
create function public.staff_request_online_benefit_eligibility(p_ids uuid[], p_eligible boolean)
returns integer language plpgsql security definer set search_path=public as $$
declare v_item public.menu_items; v_count integer:=0;
begin
  perform public.assert_menu_availability_writer();
  if p_ids is null or cardinality(p_ids) not between 1 and 100 or p_eligible is null then
    raise exception 'Select between 1 and 100 items and a valid eligibility setting';
  end if;
  if (select count(distinct id) from unnest(p_ids) id) <> cardinality(p_ids) then
    raise exception 'Selection contains duplicate or invalid items';
  end if;
  if (select count(*) from public.menu_items where id=any(p_ids))<>cardinality(p_ids) then
    raise exception 'One or more menu items no longer exist';
  end if;
  for v_item in select * from public.menu_items where id=any(p_ids) order by id for update loop
    if v_item.is_archived then raise exception 'Select active items without pending changes'; end if;
    if v_item.online_benefit_eligible is distinct from p_eligible then
      perform public.staff_create_menu_approval('change',v_item.name,
        case when p_eligible then 'Enable online SC/PWD discount eligibility' else 'Disable online SC/PWD discount eligibility' end,
        array['Online SC/PWD discount eligibility'],'set_online_benefit_eligibility',
        jsonb_build_object('id',v_item.id,'onlineBenefitEligible',p_eligible));
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.staff_request_online_benefit_eligibility(uuid[],boolean) from public;
grant execute on function public.staff_request_online_benefit_eligibility(uuid[],boolean) to authenticated;

-- Even direct table writes cannot let staff apply eligibility without review.
create function public.guard_online_benefit_eligibility()
returns trigger language plpgsql set search_path=public as $$
begin
  if (tg_op='INSERT' and new.online_benefit_eligible)
     or (tg_op='UPDATE' and new.online_benefit_eligible is distinct from old.online_benefit_eligible) then
    if not public.is_admin_profile() then raise exception 'Discount eligibility requires administrator approval'; end if;
  end if;
  return new;
end;
$$;
create trigger guard_online_benefit_eligibility before insert or update of online_benefit_eligible
  on public.menu_items for each row execute function public.guard_online_benefit_eligibility();
