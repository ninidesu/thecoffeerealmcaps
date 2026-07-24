-- CoffeeRealm custom 6-digit customer signup OTP storage
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
