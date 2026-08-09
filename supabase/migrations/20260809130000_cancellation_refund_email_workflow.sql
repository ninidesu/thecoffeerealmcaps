-- Unified customer/staff cancellation workflow with refund gating and a
-- durable email outbox. Business actions commit even when email delivery is
-- temporarily unavailable; the outbox dispatcher retries independently.

alter table public.orders
  add column if not exists cancellation_status text not null default 'none',
  add column if not exists fulfillment_hold boolean not null default false,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_requested_by_role text,
  add column if not exists cancellation_reviewed_at timestamptz,
  add column if not exists cancellation_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_review_notes text;

alter table public.orders drop constraint if exists orders_cancellation_status_check;
alter table public.orders add constraint orders_cancellation_status_check
  check (cancellation_status in ('none','requested','rejected','cancelled','resolved'));

alter table public.orders drop constraint if exists orders_refund_status_check;
alter table public.orders add constraint orders_refund_status_check
  check (refund_status in ('not_applicable','pending_review','pending','approved','processing','processed','failed','rejected'));

update public.orders
set cancellation_status = case
  when status <> 'Cancelled' then 'none'
  when cancellation_resolved then 'resolved'
  else 'cancelled'
end
where cancellation_status = 'none';

alter table public.order_cancellations
  add column if not exists event_type text not null default 'cancelled';
alter table public.order_cancellations drop constraint if exists order_cancellations_event_type_check;
alter table public.order_cancellations add constraint order_cancellations_event_type_check
  check (event_type in ('requested','cancelled','rejected','resolved'));

alter table public.refunds drop constraint if exists refunds_refund_status_check;
alter table public.refunds add constraint refunds_refund_status_check
  check (refund_status in ('pending','approved','processing','processed','failed','rejected'));

create table if not exists public.order_email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'order_cancelled',
    'cancellation_requested',
    'cancellation_approved_refund_pending',
    'cancellation_rejected',
    'refund_processed'
  )),
  recipient_email text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists order_email_outbox_pending_idx
  on public.order_email_outbox(status, next_attempt_at, created_at);
create index if not exists order_email_outbox_order_idx
  on public.order_email_outbox(order_id, created_at desc);
alter table public.order_email_outbox enable row level security;

create or replace function public.queue_order_email(
  p_order_id uuid,
  p_event_type text,
  p_dedupe_key text,
  p_refund_amount numeric default null,
  p_refund_reference text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_method text;
  v_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or nullif(btrim(coalesce(v_order.customer_email, '')), '') is null then
    return null;
  end if;

  select method into v_method
  from public.payments
  where order_id = p_order_id
  order by created_at desc
  limit 1;

  insert into public.order_email_outbox (
    order_id, customer_id, event_type, recipient_email, payload, dedupe_key
  ) values (
    p_order_id,
    v_order.customer_id,
    p_event_type,
    btrim(v_order.customer_email),
    jsonb_build_object(
      'order_number', v_order.order_number,
      'customer_name', coalesce(v_order.customer_name, 'Customer'),
      'order_type', v_order.order_type,
      'final_total', v_order.final_total,
      'payment_method', coalesce(v_method, 'unknown'),
      'payment_status', v_order.payment_status,
      'refund_status', v_order.refund_status,
      'refund_amount', p_refund_amount,
      'refund_reference', nullif(btrim(coalesce(p_refund_reference, '')), ''),
      'cancellation_reason', v_order.cancellation_reason,
      'cancellation_notes', v_order.cancellation_notes,
      'requested_by_role', v_order.cancellation_requested_by_role,
      'cancelled_by_role', v_order.cancelled_by_role,
      'review_notes', v_order.cancellation_review_notes
    ),
    p_dedupe_key
  )
  on conflict (dedupe_key) do update set dedupe_key = excluded.dedupe_key
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.queue_order_email(uuid,text,text,numeric,text) from public;

create or replace function public.customer_cancel_order(
  p_order_id uuid, p_reason text, p_notes text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_needs_review boolean;
  v_email_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_reason = '' then raise exception 'A cancellation reason is required'; end if;
  if lower(v_reason) = 'other' and v_notes is null then
    raise exception 'Please describe your reason for cancelling';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.customer_id is null or v_order.customer_id <> auth.uid() then
    raise exception 'You can only cancel your own orders';
  end if;
  if v_order.cancellation_status = 'requested' then
    raise exception 'A cancellation request is already under review';
  end if;
  if v_order.status not in ('Order Received','Awaiting Payment Verification','Pending Confirmation') then
    raise exception 'This order can no longer be cancelled because preparation may have already started';
  end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id
  order by created_at desc
  limit 1;

  v_needs_review := coalesce(v_order.payment_confirmed, false)
    or lower(coalesce(v_order.payment_status, '')) = 'paid'
    or lower(coalesce(v_payment.status, '')) = 'paid'
    or (coalesce(v_payment.method, '') in ('gcash','bank_transfer') and v_order.payment_proof_path is not null);

  if v_needs_review then
    update public.orders set
      cancellation_status = 'requested',
      fulfillment_hold = true,
      cancellation_reason = v_reason,
      cancellation_notes = v_notes,
      cancellation_requested_at = now(),
      cancellation_requested_by = auth.uid(),
      cancellation_requested_by_role = 'Customer',
      cancellation_reviewed_at = null,
      cancellation_reviewed_by = null,
      cancellation_review_notes = null,
      cancellation_resolved = false,
      refund_status = 'pending_review',
      updated_at = now()
    where id = p_order_id;

    insert into public.order_cancellations (
      order_id, customer_id, previous_status, cancellation_reason, cancellation_notes,
      cancelled_by, cancelled_by_role, payment_status, refund_status, event_type
    ) values (
      p_order_id, auth.uid(), v_order.status, v_reason, v_notes,
      auth.uid(), 'Customer', v_order.payment_status, 'pending_review', 'requested'
    );

    v_email_id := public.queue_order_email(
      p_order_id, 'cancellation_requested',
      p_order_id::text || ':cancellation_requested:' || extract(epoch from clock_timestamp())::text
    );

    return jsonb_build_object(
      'id', p_order_id,
      'action', 'review_requested',
      'status', v_order.status,
      'cancellation_status', 'requested',
      'refund_status', 'pending_review',
      'email_event_id', v_email_id
    );
  end if;

  update public.orders set
    status = 'Cancelled',
    cancellation_status = 'resolved',
    fulfillment_hold = false,
    cancellation_reason = v_reason,
    cancellation_notes = v_notes,
    cancelled_by = auth.uid(),
    cancelled_by_role = 'Customer',
    cancelled_at = now(),
    cancellation_requested_at = now(),
    cancellation_requested_by = auth.uid(),
    cancellation_requested_by_role = 'Customer',
    cancellation_reviewed_at = now(),
    cancellation_reviewed_by = auth.uid(),
    cancellation_review_notes = 'No verified payment or submitted payment proof. No refund required.',
    cancellation_resolved = true,
    cancellation_resolved_at = now(),
    cancellation_resolved_by = auth.uid(),
    refund_status = 'not_applicable',
    updated_at = now()
  where id = p_order_id;

  insert into public.order_cancellations (
    order_id, customer_id, previous_status, cancellation_reason, cancellation_notes,
    cancelled_by, cancelled_by_role, payment_status, refund_status, event_type
  ) values (
    p_order_id, auth.uid(), v_order.status, v_reason, v_notes,
    auth.uid(), 'Customer', v_order.payment_status, 'not_applicable', 'cancelled'
  );

  v_email_id := public.queue_order_email(
    p_order_id, 'order_cancelled', p_order_id::text || ':order_cancelled'
  );

  return jsonb_build_object(
    'id', p_order_id,
    'action', 'cancelled',
    'status', 'Cancelled',
    'cancellation_status', 'resolved',
    'refund_status', 'not_applicable',
    'email_event_id', v_email_id
  );
end;
$$;

create or replace function public.staff_cancel_order(p_order_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_needs_review boolean;
  v_email_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;
  if v_reason = '' then raise exception 'A cancellation reason is required'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'Cancelled' then raise exception 'This order is already cancelled'; end if;
  if v_order.status = 'Completed' then raise exception 'A completed order cannot be cancelled'; end if;
  if v_order.cancellation_status = 'requested' then
    raise exception 'A cancellation request is already under review';
  end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id
  order by created_at desc
  limit 1;

  v_needs_review := coalesce(v_order.payment_confirmed, false)
    or lower(coalesce(v_order.payment_status, '')) = 'paid'
    or lower(coalesce(v_payment.status, '')) = 'paid'
    or (coalesce(v_payment.method, '') in ('gcash','bank_transfer') and v_order.payment_proof_path is not null);

  if v_needs_review then
    update public.orders set
      cancellation_status = 'requested',
      fulfillment_hold = true,
      cancellation_reason = v_reason,
      cancellation_notes = null,
      cancellation_requested_at = now(),
      cancellation_requested_by = auth.uid(),
      cancellation_requested_by_role = 'Operations Staff',
      cancellation_reviewed_at = null,
      cancellation_reviewed_by = null,
      cancellation_review_notes = null,
      cancellation_resolved = false,
      refund_status = 'pending_review',
      updated_at = now()
    where id = p_order_id;

    insert into public.order_cancellations (
      order_id, customer_id, previous_status, cancellation_reason, cancellation_notes,
      cancelled_by, cancelled_by_role, payment_status, refund_status, event_type
    ) values (
      p_order_id, v_order.customer_id, v_order.status, v_reason, null,
      auth.uid(), 'Operations Staff', v_order.payment_status, 'pending_review', 'requested'
    );

    v_email_id := public.queue_order_email(
      p_order_id, 'cancellation_requested',
      p_order_id::text || ':staff_cancellation_requested:' || extract(epoch from clock_timestamp())::text
    );

    return jsonb_build_object(
      'id', p_order_id,
      'action', 'review_requested',
      'status', v_order.status,
      'cancellation_status', 'requested',
      'refund_status', 'pending_review',
      'email_event_id', v_email_id
    );
  end if;

  update public.orders set
    status = 'Cancelled',
    cancellation_status = 'resolved',
    fulfillment_hold = false,
    cancellation_reason = v_reason,
    cancellation_notes = null,
    cancelled_by = auth.uid(),
    cancelled_by_role = 'Operations Staff',
    cancelled_at = now(),
    cancellation_requested_at = now(),
    cancellation_requested_by = auth.uid(),
    cancellation_requested_by_role = 'Operations Staff',
    cancellation_reviewed_at = now(),
    cancellation_reviewed_by = auth.uid(),
    cancellation_review_notes = 'No verified payment or submitted payment proof. No refund required.',
    cancellation_resolved = true,
    cancellation_resolved_at = now(),
    cancellation_resolved_by = auth.uid(),
    refund_status = 'not_applicable',
    updated_at = now()
  where id = p_order_id;

  insert into public.order_cancellations (
    order_id, customer_id, previous_status, cancellation_reason, cancellation_notes,
    cancelled_by, cancelled_by_role, payment_status, refund_status, event_type
  ) values (
    p_order_id, v_order.customer_id, v_order.status, v_reason, null,
    auth.uid(), 'Operations Staff', v_order.payment_status, 'not_applicable', 'cancelled'
  );

  v_email_id := public.queue_order_email(
    p_order_id, 'order_cancelled', p_order_id::text || ':order_cancelled'
  );

  return jsonb_build_object(
    'id', p_order_id,
    'action', 'cancelled',
    'status', 'Cancelled',
    'cancellation_status', 'resolved',
    'refund_status', 'not_applicable',
    'email_event_id', v_email_id
  );
end;
$$;

create or replace function public.staff_review_cancellation(
  p_order_id uuid,
  p_approve boolean,
  p_notes text,
  p_refund_amount numeric default null,
  p_payment_outcome text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_role text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_paid boolean;
  v_proof_pending boolean;
  v_refund_amount numeric;
  v_refund_id uuid;
  v_email_id uuid;
  v_cancel_role text;
  v_cancel_user uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff') then
    raise exception 'Cancellation review access required';
  end if;
  if v_notes is null then raise exception 'Review notes are required'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.cancellation_status <> 'requested' then
    raise exception 'This order does not have a pending cancellation request';
  end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id
  order by created_at desc
  limit 1;

  v_paid := coalesce(v_order.payment_confirmed, false)
    or lower(coalesce(v_order.payment_status, '')) = 'paid'
    or lower(coalesce(v_payment.status, '')) = 'paid';
  v_proof_pending := not v_paid
    and coalesce(v_payment.method, '') in ('gcash','bank_transfer')
    and v_order.payment_proof_path is not null;

  if v_proof_pending and p_approve and coalesce(p_payment_outcome, '') not in ('received','not_received') then
    raise exception 'Confirm whether the submitted payment was received';
  end if;

  if v_proof_pending and p_approve and p_payment_outcome = 'received' then
    v_paid := true;
    update public.orders set
      payment_status = 'paid', payment_confirmed = true,
      payment_confirmed_at = coalesce(payment_confirmed_at, now())
    where id = p_order_id;
    update public.payments set
      status = 'paid', confirmed_at = coalesce(confirmed_at, now()), confirmed_by = auth.uid()
    where id = v_payment.id;
  end if;

  if not p_approve then
    update public.orders set
      cancellation_status = 'rejected',
      fulfillment_hold = false,
      cancellation_reviewed_at = now(),
      cancellation_reviewed_by = auth.uid(),
      cancellation_review_notes = v_notes,
      refund_status = 'not_applicable',
      updated_at = now()
    where id = p_order_id;

    insert into public.order_cancellations (
      order_id, customer_id, previous_status, cancellation_reason, cancellation_notes,
      cancelled_by, cancelled_by_role, payment_status, refund_status, event_type
    ) values (
      p_order_id, v_order.customer_id, v_order.status, v_order.cancellation_reason, v_notes,
      auth.uid(), 'Operations Staff', v_order.payment_status, 'not_applicable', 'rejected'
    );

    v_email_id := public.queue_order_email(
      p_order_id, 'cancellation_rejected',
      p_order_id::text || ':cancellation_rejected:' || extract(epoch from clock_timestamp())::text
    );
    return jsonb_build_object(
      'id', p_order_id, 'action', 'rejected', 'status', v_order.status,
      'cancellation_status', 'rejected', 'refund_status', 'not_applicable',
      'email_event_id', v_email_id
    );
  end if;

  v_cancel_role := coalesce(v_order.cancellation_requested_by_role, 'Operations Staff');
  v_cancel_user := coalesce(v_order.cancellation_requested_by, auth.uid());

  if v_paid then
    v_refund_amount := coalesce(p_refund_amount, v_order.final_total);
    if v_refund_amount <= 0 or v_refund_amount > v_order.final_total then
      raise exception 'Refund amount must be greater than zero and cannot exceed the order total';
    end if;
    if exists (
      select 1 from public.refunds
      where order_id = p_order_id and refund_status in ('pending','approved','processing','processed')
    ) then
      raise exception 'A refund already exists for this cancellation';
    end if;

    insert into public.refunds (
      order_id, payment_id, original_amount, refund_amount, refund_reason,
      refund_method, refund_status, requested_by
    ) values (
      p_order_id, v_payment.id, v_order.final_total, v_refund_amount,
      coalesce(v_order.cancellation_reason, 'Approved order cancellation'),
      coalesce(v_payment.method, 'manual'), 'pending', auth.uid()
    ) returning id into v_refund_id;
  end if;

  update public.orders set
    status = 'Cancelled',
    cancellation_status = case when v_paid then 'cancelled' else 'resolved' end,
    fulfillment_hold = false,
    cancelled_by = v_cancel_user,
    cancelled_by_role = v_cancel_role,
    cancelled_at = now(),
    cancellation_reviewed_at = now(),
    cancellation_reviewed_by = auth.uid(),
    cancellation_review_notes = v_notes,
    cancellation_resolved = not v_paid,
    cancellation_resolved_at = case when v_paid then null else now() end,
    cancellation_resolved_by = case when v_paid then null else auth.uid() end,
    refund_status = case when v_paid then 'pending' else 'not_applicable' end,
    updated_at = now()
  where id = p_order_id;

  insert into public.order_cancellations (
    order_id, customer_id, previous_status, cancellation_reason, cancellation_notes,
    cancelled_by, cancelled_by_role, payment_status, refund_status, event_type
  ) values (
    p_order_id, v_order.customer_id, v_order.status, v_order.cancellation_reason, v_notes,
    v_cancel_user, v_cancel_role, case when v_paid then 'paid' else v_order.payment_status end,
    case when v_paid then 'pending' else 'not_applicable' end, 'cancelled'
  );

  if v_paid then
    insert into public.transaction_audit_log (order_id, action, reason, new_value, performed_by)
    values (
      p_order_id, 'refund_requested', v_order.cancellation_reason,
      jsonb_build_object('refund_id', v_refund_id, 'amount', v_refund_amount, 'source', 'cancellation_review'),
      auth.uid()
    );
    v_email_id := public.queue_order_email(
      p_order_id, 'cancellation_approved_refund_pending',
      p_order_id::text || ':refund_pending:' || v_refund_id::text,
      v_refund_amount, null
    );
  else
    v_email_id := public.queue_order_email(
      p_order_id, 'order_cancelled',
      p_order_id::text || ':order_cancelled:' || extract(epoch from clock_timestamp())::text
    );
  end if;

  return jsonb_build_object(
    'id', p_order_id,
    'action', case when v_paid then 'refund_pending' else 'cancelled' end,
    'status', 'Cancelled',
    'cancellation_status', case when v_paid then 'cancelled' else 'resolved' end,
    'refund_status', case when v_paid then 'pending' else 'not_applicable' end,
    'refund_id', v_refund_id,
    'email_event_id', v_email_id
  );
end;
$$;

create or replace function public.staff_resolve_cancellation(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'Cancelled' then raise exception 'Cancelled order not found'; end if;
  if v_order.refund_status in ('pending_review','pending','approved','processing','failed') then
    raise exception 'This cancellation cannot be resolved until its refund is completed or rejected';
  end if;

  update public.orders set
    cancellation_status = 'resolved', cancellation_resolved = true,
    cancellation_resolved_at = now(), cancellation_resolved_by = auth.uid(), updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('id', p_order_id, 'cancellation_status', 'resolved', 'cancellation_resolved', true);
end;
$$;

create or replace function public.staff_confirm_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_method text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.fulfillment_hold or v_order.cancellation_status = 'requested' then
    raise exception 'This order is on hold for cancellation review';
  end if;
  if v_order.status not in ('Order Received','Awaiting Payment Verification','Pending Confirmation') then
    raise exception 'This order is not awaiting confirmation';
  end if;

  select method into v_method from public.payments where order_id = p_order_id order by created_at desc limit 1;
  if v_method in ('gcash','bank_transfer') then
    if v_order.payment_proof_path is null then raise exception 'Payment proof has not been uploaded yet'; end if;
    update public.orders set
      status = 'Preparing', payment_status = 'paid', payment_confirmed = true,
      payment_confirmed_at = now(), updated_at = now()
    where id = p_order_id;
    update public.payments set status = 'paid', confirmed_at = now(), confirmed_by = auth.uid()
    where order_id = p_order_id;
  else
    update public.orders set status = 'Preparing', updated_at = now() where id = p_order_id;
  end if;

  return jsonb_build_object('id', p_order_id, 'status', 'Preparing');
end;
$$;

create or replace function public.staff_advance_order_status(p_order_id uuid, p_new_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_pending boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.normalize_role(role) into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','staff','operational_staff','cashier') then
    raise exception 'Operations access required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.fulfillment_hold or v_order.cancellation_status = 'requested' then
    raise exception 'This order is on hold for cancellation review';
  end if;
  if v_order.status = 'Cancelled' then raise exception 'This order has been cancelled'; end if;
  if v_order.status = 'Completed' then raise exception 'This order is already completed'; end if;

  v_pending := v_order.status in ('Order Received','Awaiting Payment Verification','Pending Confirmation');
  if p_new_status = 'Preparing' then
    if not v_pending then raise exception 'Only pending orders can move to Preparing'; end if;
  elsif p_new_status = 'Ready for Pickup' then
    if v_order.status <> 'Preparing' then raise exception 'Only preparing orders can be marked ready'; end if;
    if v_order.order_type <> 'pickup' then raise exception 'Only pickup orders can be marked Ready for Pickup'; end if;
  elsif p_new_status = 'Out for Delivery' then
    if v_order.status <> 'Preparing' then raise exception 'Only preparing orders can be dispatched'; end if;
    if v_order.order_type <> 'delivery' then raise exception 'Only delivery orders can be marked Out for Delivery'; end if;
  elsif p_new_status = 'Completed' then
    if v_order.order_type = 'pickup' and v_order.status <> 'Ready for Pickup' then
      raise exception 'Only orders ready for pickup can be completed';
    end if;
    if v_order.order_type = 'delivery' and v_order.status <> 'Out for Delivery' then
      raise exception 'Only orders out for delivery can be completed';
    end if;
  else
    raise exception 'Unsupported status transition';
  end if;

  update public.orders set status = p_new_status, updated_at = now() where id = p_order_id;
  if p_new_status = 'Completed' then perform public.deduct_order_ingredients(p_order_id); end if;
  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$$;

create or replace function public.staff_process_refund(
  p_refund_id uuid, p_approve boolean, p_reference_number text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_refund public.refunds%rowtype;
  v_order_id uuid;
  v_total_processed numeric;
  v_final_total numeric;
  v_pending_count integer;
begin
  perform public.assert_transaction_writer();
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund request not found'; end if;
  if v_refund.refund_status not in ('pending','approved','processing','failed') then
    raise exception 'This refund has already been resolved';
  end if;
  if p_approve and nullif(btrim(coalesce(p_reference_number, '')), '') is null then
    raise exception 'A refund reference number is required';
  end if;

  update public.refunds set
    refund_status = case when p_approve then 'processed' else 'rejected' end,
    processed_by = auth.uid(), processed_at = now(),
    reference_number = nullif(btrim(coalesce(p_reference_number, '')), '')
  where id = p_refund_id;

  v_order_id := v_refund.order_id;
  select final_total into v_final_total from public.orders where id = v_order_id;
  select coalesce(sum(refund_amount), 0) into v_total_processed
  from public.refunds where order_id = v_order_id and refund_status = 'processed';
  select count(*) into v_pending_count
  from public.refunds where order_id = v_order_id and refund_status in ('pending','approved','processing','failed');

  update public.orders set
    refund_status = case
      when v_pending_count > 0 then 'pending'
      when v_total_processed > 0 then 'processed'
      else 'rejected'
    end,
    cancellation_status = case
      when p_approve and status = 'Cancelled' and v_pending_count = 0 then 'resolved'
      else cancellation_status
    end,
    cancellation_resolved = case
      when p_approve and status = 'Cancelled' and v_pending_count = 0 then true
      else cancellation_resolved
    end,
    cancellation_resolved_at = case
      when p_approve and status = 'Cancelled' and v_pending_count = 0 then now()
      else cancellation_resolved_at
    end,
    cancellation_resolved_by = case
      when p_approve and status = 'Cancelled' and v_pending_count = 0 then auth.uid()
      else cancellation_resolved_by
    end,
    updated_at = now()
  where id = v_order_id;

  insert into public.transaction_audit_log (order_id, action, reason, new_value, performed_by)
  values (
    v_order_id,
    case when p_approve then 'refund_processed' else 'refund_rejected' end,
    p_reference_number,
    jsonb_build_object('refund_id', p_refund_id, 'amount', v_refund.refund_amount),
    auth.uid()
  );

  if p_approve then
    perform public.queue_order_email(
      v_order_id, 'refund_processed',
      v_order_id::text || ':refund_processed:' || p_refund_id::text,
      v_refund.refund_amount, p_reference_number
    );
  end if;
end;
$$;

revoke all on function public.customer_cancel_order(uuid,text,text) from public;
revoke all on function public.staff_cancel_order(uuid,text) from public;
revoke all on function public.staff_review_cancellation(uuid,boolean,text,numeric,text) from public;
revoke all on function public.staff_resolve_cancellation(uuid) from public;
revoke execute on function public.staff_update_refund_status(uuid,text) from authenticated;
grant execute on function public.customer_cancel_order(uuid,text,text) to authenticated;
grant execute on function public.staff_cancel_order(uuid,text) to authenticated;
grant execute on function public.staff_review_cancellation(uuid,boolean,text,numeric,text) to authenticated;
grant execute on function public.staff_resolve_cancellation(uuid) to authenticated;

notify pgrst, 'reload schema';
