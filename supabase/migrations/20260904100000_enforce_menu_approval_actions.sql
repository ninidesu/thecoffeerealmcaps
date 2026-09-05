-- Store the operation and its validated menu payload so admin approval is the
-- point at which a staff menu change is applied.
alter table public.menu_change_approvals
  add column if not exists operation text,
  add column if not exists payload jsonb not null default '{}'::jsonb;

create or replace function public.staff_create_menu_approval(
  p_action text, p_item_name text, p_summary text, p_change_types text[], p_operation text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public.normalize_role(role) in ('admin','staff','operational_staff') and removed_at is null) then
    raise exception 'Staff access required';
  end if;
  if p_action not in ('add','change','remove') or btrim(coalesce(p_item_name,'')) = '' then
    raise exception 'Invalid menu approval request';
  end if;
  if p_operation not in ('upsert_menu_item','set_availability','archive_menu_item','duplicate_menu_item','upsert_main_category','upsert_subcategory','archive_main_category','archive_subcategory','bulk_availability') then
    raise exception 'Unsupported menu approval operation';
  end if;
  insert into public.menu_change_approvals(submitted_by, action, item_name, summary, change_types, operation, payload)
  values (auth.uid(), p_action, left(btrim(p_item_name), 120), left(btrim(p_summary), 500), coalesce(p_change_types, '{}'), p_operation, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_decide_menu_approval(p_id uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
declare v_request public.menu_change_approvals%rowtype; v_item_id uuid; v_available boolean;
begin
  if not public.is_admin_profile() then raise exception 'Administrator access required'; end if;
  if p_state not in ('approved','rejected') then raise exception 'Invalid approval decision'; end if;
  select * into v_request from public.menu_change_approvals where id = p_id and state = 'pending' for update;
  if not found then raise exception 'Approval request not found or already decided'; end if;

  if p_state = 'approved' then
    if v_request.operation = 'upsert_menu_item' then
      perform public.staff_upsert_menu_item(
        nullif(v_request.payload->>'id','')::uuid,
        nullif(v_request.payload->>'mainCategoryId','')::uuid,
        nullif(v_request.payload->>'subcategoryId','')::uuid,
        v_request.payload->>'name', v_request.payload->>'slug', v_request.payload->>'description',
        (v_request.payload->>'price')::numeric, v_request.payload->>'itemType', v_request.payload->>'temperatureType',
        coalesce((v_request.payload->>'allowIce')::boolean,false), coalesce((v_request.payload->>'allowSugar')::boolean,false),
        coalesce((v_request.payload->>'allowAddons')::boolean,false), v_request.payload->>'imageUrl',
        coalesce((v_request.payload->>'manualAvailable')::boolean,true), coalesce((v_request.payload->>'isFeatured')::boolean,false),
        coalesce((v_request.payload->>'isBestseller')::boolean,false), nullif(v_request.payload->>'prepTimeMinutes','')::integer,
        nullif(v_request.payload->>'availableFrom','')::date, nullif(v_request.payload->>'availableUntil','')::date,
        coalesce((v_request.payload->>'sortOrder')::integer,0), coalesce(v_request.payload->'variantOptions','{}'::jsonb)
      );
    elsif v_request.operation = 'set_availability' then
      perform public.staff_set_menu_item_availability((v_request.payload->>'id')::uuid, (v_request.payload->>'manualAvailable')::boolean);
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
    elsif v_request.operation = 'bulk_availability' then
      v_available := (v_request.payload->>'available')::boolean;
      for v_item_id in select value::uuid from jsonb_array_elements_text(coalesce(v_request.payload->'ids','[]'::jsonb)) loop
        perform public.staff_set_menu_item_availability(v_item_id, v_available);
      end loop;
    else
      raise exception 'Unsupported menu approval operation';
    end if;
  end if;

  update public.menu_change_approvals set state = p_state, reviewed_by = auth.uid(), decided_at = now() where id = p_id;
end;
$$;

revoke all on function public.staff_create_menu_approval(text,text,text,text[]) from public;
revoke all on function public.staff_create_menu_approval(text,text,text,text[],text,jsonb) from public;
revoke all on function public.admin_decide_menu_approval(uuid,text) from public;
grant execute on function public.staff_create_menu_approval(text,text,text,text[],text,jsonb) to authenticated;
grant execute on function public.admin_decide_menu_approval(uuid,text) to authenticated;
