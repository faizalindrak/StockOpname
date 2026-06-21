-- Adds NOTIFY triggers so the Hono server can broadcast table changes
-- over WebSocket. Run this in addition to the existing migrations.

create or replace function public.notify_table_change() returns trigger as $$
declare
  payload jsonb;
begin
  if (tg_op = 'DELETE') then
    payload := jsonb_build_object(
      'event', 'DELETE',
      'table', tg_table_name,
      'old', to_jsonb(old)
    );
  elsif (tg_op = 'UPDATE') then
    payload := jsonb_build_object(
      'event', 'UPDATE',
      'table', tg_table_name,
      'new', to_jsonb(new),
      'old', to_jsonb(old)
    );
  else
    payload := jsonb_build_object(
      'event', 'INSERT',
      'table', tg_table_name,
      'new', to_jsonb(new)
    );
  end if;
  perform pg_notify(tg_table_name || '_changes', payload::text);
  return coalesce(new, old);
end;
$$ language plpgsql;

do $$
declare
  t text;
  tables text[] := array['items', 'categories', 'locations', 'profiles', 'sessions', 'session_items', 'session_users', 'counts', 'item_groups', 'item_group_items', 'report_status_raw_mat'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I_notify_trg on public.%I', t, t);
    execute format('create trigger %I_notify_trg after insert or update or delete on public.%I for each row execute function public.notify_table_change()', t, t);
  end loop;
end $$;
