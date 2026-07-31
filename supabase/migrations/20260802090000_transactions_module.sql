-- Transactions module for Admin/Operations Staff: financial review of every
-- order (customer_pos + cashier_pos) with proper refund/void tracking and an
-- audit trail. Reuses orders/order_items/payments/order_cancellations as-is
-- (they already carry per-order snapshots, so editing a menu item later never
-- touches historical order rows). Adds only what's genuinely missing: a real
-- refund ledger (today there's only a status flag), void support (didn't
-- exist at all), a receipt number distinct from order_number, and a generic
-- financial audit log.

-- 1. Receipt numbering. A trigger (not touching either checkout RPC) so both
--    create_customer_order and create_cashier_order get one for free.
create sequence if not exists public.receipt_number_seq;
alter table public.orders add column if not exists receipt_number text;

create or replace function public.assign_receipt_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.receipt_number is null then
    new.receipt_number := 'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists assign_receipt_number_trigger on public.orders;
create trigger assign_receipt_number_trigger
  before insert on public.orders
  for each row execute function public.assign_receipt_number();

update public.orders set receipt_number = 'RCPT-' || to_char(created_at, 'YYYYMMDD') || '-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0')
  where receipt_number is null;
alter table public.orders add constraint orders_receipt_number_uidx unique (receipt_number);

-- 2. Void support (didn't exist before — distinct from Cancel and Refund).
alter table public.orders
  add column if not exists is_voided boolean not null default false,
  add column if not exists voided_reason text,
  add column if not exists voided_by uuid references public.profiles(id),
  add column if not exists voided_at timestamptz;

-- 3. Refund ledger — the existing refund_status column is kept (cheap flag
--    used elsewhere), this table is the actual money record.
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  original_amount numeric(12,2) not null check (original_amount >= 0),
  refund_amount numeric(12,2) not null check (refund_amount > 0),
  refund_reason text not null,
  refund_method text not null,
  refund_status text not null default 'pending' check (refund_status in ('pending','processed','rejected')),
  processed_by uuid references public.profiles(id),
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  reference_number text
);
create index if not exists refunds_order_id_idx on public.refunds(order_id);

-- 4. Generic financial audit log — every sensitive action (void, refund,
--    payment-status correction) writes one row here with before/after state.
create table if not exists public.transaction_audit_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  action text not null check (action in ('void','refund_requested','refund_processed','refund_rejected','payment_status_corrected')),
  reason text,
  previous_value jsonb,
  new_value jsonb,
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists transaction_audit_log_order_id_idx on public.transaction_audit_log(order_id);

-- 5. RLS — staff-only read (customers already have their own order-read
--    policies elsewhere; this module is internal). All writes via RPC.
alter table public.refunds enable row level security;
alter table public.transaction_audit_log enable row level security;
drop policy if exists "Staff read refunds" on public.refunds;
create policy "Staff read refunds" on public.refunds for select to authenticated using (public.is_staff_profile());
drop policy if exists "Staff read audit log" on public.transaction_audit_log;
create policy "Staff read audit log" on public.transaction_audit_log for select to authenticated using (public.is_staff_profile());

-- 6. Writer guard — admin + staff-type roles manage transactions; cashier is
--    excluded from void/refund/correction (review-only), matching the spec's
--    "ordinary staff cannot directly edit completed financial records" intent
--    by restricting these specific actions to admin/staff/operational_staff.
create or replace function public.assert_transaction_writer() returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','staff','operational_staff') then
    raise exception 'Transaction management access required';
  end if;
end;
$$;

-- 7. Void: invalidates a recorded/completed transaction. Distinct from
--    Cancel (stops an order before completion — already handled by
--    staff_cancel_order) and from Refund (money movement after payment).
create or replace function public.staff_void_order(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  perform public.assert_transaction_writer();
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'A void reason is required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.is_voided then raise exception 'This transaction is already voided'; end if;

  update public.orders set is_voided = true, voided_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now(), updated_at = now()
    where id = p_order_id;

  insert into public.transaction_audit_log (order_id, action, reason, previous_value, new_value, performed_by)
    values (p_order_id, 'void', p_reason, jsonb_build_object('is_voided', false), jsonb_build_object('is_voided', true), auth.uid());
end;
$$;

-- 8. Refund: request (any staff-type) then process/reject (same roles here,
--    since this project has no separate "approval" role today). Prevents
--    requesting more than what remains unrefunded, and prevents double
--    processing of the same refund row.
create or replace function public.staff_request_refund(
  p_order_id uuid, p_amount numeric, p_reason text, p_method text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_payment_id uuid;
  v_already_refunded numeric;
  v_id uuid;
begin
  perform public.assert_transaction_writer();
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'A refund reason is required'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Refund amount must be greater than zero'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_status <> 'paid' then raise exception 'Only paid transactions can be refunded'; end if;

  select id into v_payment_id from public.payments where order_id = p_order_id order by created_at desc limit 1;

  select coalesce(sum(refund_amount), 0) into v_already_refunded
    from public.refunds where order_id = p_order_id and refund_status in ('pending','processed');
  if v_already_refunded + p_amount > v_order.final_total then
    raise exception 'Refund amount exceeds the remaining refundable balance (% already requested/processed of %)', v_already_refunded, v_order.final_total;
  end if;

  insert into public.refunds (order_id, payment_id, original_amount, refund_amount, refund_reason, refund_method, refund_status, requested_by)
    values (p_order_id, v_payment_id, v_order.final_total, p_amount, btrim(p_reason), coalesce(p_method, 'manual'), 'pending', auth.uid())
    returning id into v_id;

  update public.orders set refund_status = 'pending', updated_at = now() where id = p_order_id;

  insert into public.transaction_audit_log (order_id, action, reason, new_value, performed_by)
    values (p_order_id, 'refund_requested', p_reason, jsonb_build_object('refund_id', v_id, 'amount', p_amount), auth.uid());

  return v_id;
end;
$$;

create or replace function public.staff_process_refund(p_refund_id uuid, p_approve boolean, p_reference_number text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_refund public.refunds%rowtype;
  v_order_id uuid;
  v_total_processed numeric;
  v_final_total numeric;
begin
  perform public.assert_transaction_writer();
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund request not found'; end if;
  if v_refund.refund_status <> 'pending' then raise exception 'This refund has already been resolved'; end if;

  update public.refunds set
    refund_status = case when p_approve then 'processed' else 'rejected' end,
    processed_by = auth.uid(), processed_at = now(),
    reference_number = nullif(btrim(coalesce(p_reference_number,'')), '')
    where id = p_refund_id;

  v_order_id := v_refund.order_id;
  select final_total into v_final_total from public.orders where id = v_order_id;
  select coalesce(sum(refund_amount), 0) into v_total_processed from public.refunds where order_id = v_order_id and refund_status = 'processed';

  update public.orders set
    refund_status = case
      when not p_approve then 'rejected'
      when v_total_processed >= v_final_total then 'processed'
      else 'pending'
    end,
    updated_at = now()
    where id = v_order_id;

  insert into public.transaction_audit_log (order_id, action, reason, new_value, performed_by)
    values (v_order_id, case when p_approve then 'refund_processed' else 'refund_rejected' end, p_reference_number,
      jsonb_build_object('refund_id', p_refund_id, 'amount', v_refund.refund_amount), auth.uid());
end;
$$;

-- 9. Payment-status correction — for real-world mistakes (e.g. cashier marked
--    a bank transfer paid before the proof was actually checked). Requires a
--    reason and is fully audited; never silently changes order status.
create or replace function public.staff_correct_payment_status(p_order_id uuid, p_new_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_previous text;
begin
  perform public.assert_transaction_writer();
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'A reason is required for a payment-status correction'; end if;
  if p_new_status not in ('paid','pending') then raise exception 'Unsupported payment status'; end if;

  select payment_status into v_previous from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  update public.orders set payment_status = p_new_status, payment_confirmed = (p_new_status = 'paid'), updated_at = now() where id = p_order_id;
  update public.payments set status = p_new_status where order_id = p_order_id;

  insert into public.transaction_audit_log (order_id, action, reason, previous_value, new_value, performed_by)
    values (p_order_id, 'payment_status_corrected', p_reason, jsonb_build_object('payment_status', v_previous), jsonb_build_object('payment_status', p_new_status), auth.uid());
end;
$$;

revoke all on function public.staff_void_order(uuid,text) from public;
revoke all on function public.staff_request_refund(uuid,numeric,text,text) from public;
revoke all on function public.staff_process_refund(uuid,boolean,text) from public;
revoke all on function public.staff_correct_payment_status(uuid,text,text) from public;
grant execute on function public.staff_void_order(uuid,text) to authenticated;
grant execute on function public.staff_request_refund(uuid,numeric,text,text) to authenticated;
grant execute on function public.staff_process_refund(uuid,boolean,text) to authenticated;
grant execute on function public.staff_correct_payment_status(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
