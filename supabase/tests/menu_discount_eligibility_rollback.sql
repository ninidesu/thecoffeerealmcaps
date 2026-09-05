-- Test the new menu eligibility controls without committing changes.
begin;
create temp table discount_test_context(key text primary key, value uuid);
insert into discount_test_context select 'admin',id from public.profiles where public.normalize_role(role)='admin' and removed_at is null limit 1;
insert into discount_test_context select 'staff',id from public.profiles where public.normalize_role(role) in ('staff','operational_staff') and removed_at is null limit 1;
insert into discount_test_context select 'customer',id from public.profiles where public.normalize_role(role)='customer' and removed_at is null limit 1;
insert into discount_test_context select 'first',id from public.menu_items where not is_archived and not online_benefit_eligible
 and not exists(select 1 from public.menu_change_approvals where held_item_id=menu_items.id and state='pending') order by id limit 1;
insert into discount_test_context select 'second',id from public.menu_items where not is_archived and not online_benefit_eligible
 and id<>(select value from discount_test_context where key='first')
 and not exists(select 1 from public.menu_change_approvals where held_item_id=menu_items.id and state='pending') order by id limit 1;
do $$ begin if (select count(*) from discount_test_context)<>5 then raise exception 'Test needs two active ineligible items and customer/staff/admin accounts'; end if; end $$;
grant select,insert on discount_test_context to authenticated;
set local role authenticated;
do $$ declare ids uuid[]; begin
 select array_agg(value order by key) into ids from discount_test_context where key in ('first','second');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='customer'),'role','authenticated')::text,true);
 begin
  perform public.staff_request_online_benefit_eligibility(ids,true);
  raise exception 'Customer could request a menu change';
 exception when raise_exception then if sqlerrm<>'Staff access required' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='staff'),'role','authenticated')::text,true);
 begin
  perform public.staff_request_online_benefit_eligibility(array[ids[1],gen_random_uuid()],true);
  raise exception 'Invalid batch accepted';
 exception when raise_exception then if sqlerrm<>'One or more menu items no longer exist' then raise; end if; end;
 if exists(select 1 from public.menu_items where id=any(ids) and is_archived) then raise exception 'Failed batch partially archived items'; end if;
 if public.staff_request_online_benefit_eligibility(ids,true)<>2 then raise exception 'Bulk request did not include both items'; end if;
 if (select count(*) from public.menu_items where id=any(ids) and is_archived and not online_benefit_eligible)<>2 then raise exception 'Eligibility applied before approval or items not held'; end if;
 begin
  update public.menu_items set online_benefit_eligible=true where id=ids[1];
 exception when insufficient_privilege then null;
 when raise_exception then if sqlerrm<>'Discount eligibility requires administrator approval' then raise; end if; end;
 if exists(select 1 from public.menu_items where id=any(ids) and online_benefit_eligible) then raise exception 'Staff directly enabled eligibility'; end if;
 begin
  perform public.staff_request_online_benefit_eligibility(ids,true);
  raise exception 'Duplicate pending request accepted';
 exception when raise_exception then if sqlerrm<>'Select active items without pending changes' then raise; end if; end;
end $$;
do $$ declare first_id uuid:=(select value from discount_test_context where key='first'); second_id uuid:=(select value from discount_test_context where key='second'); request_id uuid; payload jsonb; begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='admin'),'role','authenticated')::text,true);
 select id into request_id from public.menu_change_approvals where held_item_id=first_id and state='pending';
 perform public.admin_decide_menu_approval(request_id,'rejected');
 if not exists(select 1 from public.menu_items where id=first_id and not is_archived and not online_benefit_eligible) then raise exception 'Rejection did not restore original eligibility'; end if;
 select id into request_id from public.menu_change_approvals where held_item_id=second_id and state='pending';
 perform public.admin_decide_menu_approval(request_id,'approved');
 if not exists(select 1 from public.menu_items where id=second_id and not is_archived and online_benefit_eligible) then raise exception 'Approval did not enable eligibility and restore the item'; end if;
 select jsonb_build_object('id',id,'mainCategoryId',main_category_id,'subcategoryId',subcategory_id,'name',name,'slug',slug,'description',description,'price',price,'itemType',item_type,'temperatureType',temperature_type,'allowIce',allow_ice,'allowSugar',allow_sugar,'allowAddons',allow_addons,'imageUrl',image_url,'manualAvailable',manual_available,'isFeatured',is_featured,'isBestseller',is_bestseller,'prepTimeMinutes',prep_time_minutes,'availableFrom',available_from,'availableUntil',available_until,'sortOrder',sort_order,'variantOptions',variant_options,'onlineBenefitEligible',false) into payload from public.menu_items where id=second_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='staff'),'role','authenticated')::text,true);
 request_id:=public.staff_create_menu_approval('change',payload->>'name','Disable online discount',array['Online SC/PWD discount eligibility'],'upsert_menu_item',payload);
 if not exists(select 1 from public.menu_items where id=second_id and is_archived and online_benefit_eligible) then raise exception 'Editor toggle applied before approval'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='admin'),'role','authenticated')::text,true);
 perform public.admin_decide_menu_approval(request_id,'approved');
 if not exists(select 1 from public.menu_items where id=second_id and not is_archived and not online_benefit_eligible) then raise exception 'Editor toggle approval did not persist'; end if;
 -- New-item requests must remain ineligible while archived, then gain eligibility on approval.
 payload:=payload-'id'||jsonb_build_object('name','Eligibility Test '||gen_random_uuid()::text,'slug','eligibility-test-'||gen_random_uuid()::text,'onlineBenefitEligible',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='staff'),'role','authenticated')::text,true);
 request_id:=public.staff_create_menu_approval('add',payload->>'name','New eligible item',array['New item'],'upsert_menu_item',payload);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from discount_test_context where key='admin'),'role','authenticated')::text,true);
 if not exists(select 1 from public.menu_items where id=(select held_item_id from public.menu_change_approvals where id=request_id) and is_archived and not online_benefit_eligible) then raise exception 'New item was enabled before approval'; end if;
 perform public.admin_decide_menu_approval(request_id,'approved');
 if not exists(select 1 from public.menu_items where id=(select held_item_id from public.menu_change_approvals where id=request_id) and not is_archived and online_benefit_eligible) then raise exception 'New item eligibility was not approved'; end if;
end $$;
reset role;
rollback;
select 'PASS: atomic bulk requests, private staff actions, no premature eligibility, archived holds, approval/rejection, editor toggle, and new eligible items. All changes rolled back.' as result;
