-- Scheduled orders now appear in the active queue; completed orders have their own queue.
alter table public.staff_preferences
  drop constraint if exists staff_preferences_order_queue_check;

update public.staff_preferences
set order_queue = 'active'
where order_queue = 'scheduled';

alter table public.staff_preferences
  add constraint staff_preferences_order_queue_check
  check (order_queue in ('active', 'completed'));
