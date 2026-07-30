-- TEMPORARY diagnostic only. Read-only, no data exposed (column names/types
-- from information_schema, not row data). Safe to run, and should be dropped
-- again after use — see the follow-up migration that removes it.
create or replace function public.__diag_columns(p_table text) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('column', column_name, 'type', data_type, 'nullable', is_nullable) order by ordinal_position), '[]'::jsonb)
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table;
$$;

grant execute on function public.__diag_columns(text) to anon, authenticated;
notify pgrst,'reload schema';
