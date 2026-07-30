-- TEMPORARY diagnostic only. Read-only (information_schema/pg_policies
-- metadata, no row data). Safe to run; will be dropped by a follow-up
-- migration once used.
create or replace function public.__diag_table(p_table text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object('column', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) order by ordinal_position), '[]'::jsonb)
      from information_schema.columns
      where table_schema = 'public' and table_name = p_table
    ),
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object('policy', policyname, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check)), '[]'::jsonb)
      from pg_policies
      where schemaname = 'public' and tablename = p_table
    ),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object('name', conname, 'def', pg_get_constraintdef(oid))), '[]'::jsonb)
      from pg_constraint
      where conrelid = ('public.' || quote_ident(p_table))::regclass
    )
  );
$$;

grant execute on function public.__diag_table(text) to anon, authenticated;
notify pgrst,'reload schema';
