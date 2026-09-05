-- Staff menu actions must go through menu_change_approvals. The approval RPC
-- invokes these writers as the approving administrator after review.
create or replace function public.assert_menu_writer()
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if public.normalize_role(v_role) <> 'admin' then
    raise exception 'Menu changes require administrator approval';
  end if;
end;
$$;
