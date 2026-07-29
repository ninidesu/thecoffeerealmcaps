-- thecoffeerealm custom 6-digit customer signup OTP storage
-- Run this in Supabase SQL Editor before deploying the customer OTP Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.customer_email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  username text,
  purpose text not null default 'register' check (purpose in ('register')),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_email_otps_email_purpose_created_idx
  on public.customer_email_otps (lower(email), purpose, created_at desc);

alter table public.customer_email_otps enable row level security;

-- No public RLS policies are intentionally created.
-- These rows should only be read/written by Supabase Edge Functions using the service-role key.

create table if not exists public.customer_otp_rate_limits (
  scope text not null check (scope in ('email','ip','global')),
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (scope, key_hash)
);

alter table public.customer_otp_rate_limits enable row level security;

create or replace function public.consume_customer_otp_rate_limit(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if p_scope not in ('email','ip','global') or p_key_hash is null or p_key_hash = '' then
    raise exception 'Invalid OTP rate-limit key';
  end if;
  if p_window_seconds < 1 or p_max_requests < 1 then
    raise exception 'Invalid OTP rate-limit configuration';
  end if;

  insert into public.customer_otp_rate_limits as rate
    (scope, key_hash, window_started_at, request_count)
  values (p_scope, p_key_hash, now(), 1)
  on conflict (scope, key_hash) do update set
    window_started_at = case
      when rate.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else rate.window_started_at
    end,
    request_count = case
      when rate.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else rate.request_count + 1
    end
  returning request_count <= p_max_requests into allowed;

  return allowed;
end;
$$;

revoke all on function public.consume_customer_otp_rate_limit(text,text,integer,integer) from public;
grant execute on function public.consume_customer_otp_rate_limit(text,text,integer,integer) to service_role;

-- No public RLS policies are intentionally created for rate-limit counters.
