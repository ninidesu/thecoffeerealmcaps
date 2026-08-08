-- Add an independently configurable bell alert for customer cancellations and refund requests.
alter table public.staff_preferences
  add column if not exists notify_customer_cancellations boolean not null default true;

notify pgrst, 'reload schema';
