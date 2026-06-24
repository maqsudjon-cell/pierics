-- ════════════════════════════════════════════════════════════════════
-- PIERICS — payment & pricing schema (Supabase / PostgreSQL)
-- Run top-to-bottom in the Supabase SQL editor. Idempotent (safe to re-run).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Base tables (created only if your project doesn't have them yet) ──
-- If `users` / `usage_logs` already exist, these no-op and the ALTERs below
-- add the new columns.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text,
  created_at    timestamptz default now()
);

create table if not exists usage_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  provider      text,
  model         text,
  input_tokens  bigint default 0,
  output_tokens bigint default 0,
  created_at    timestamptz default now()
);

-- ── // 001  Modify users table ──────────────────────────────────────
alter table users
  add column if not exists plan                text default 'free'
    check (plan in ('free','payg','pro')),
  add column if not exists token_balance        decimal(10,4) default 0,
  add column if not exists tokens_used_this_month bigint default 0,
  add column if not exists stripe_customer_id   text,
  add column if not exists trial_ends_at        timestamptz,
  add column if not exists subscription_status  text default 'inactive',
  add column if not exists usage_period_start   timestamptz default now();  -- for monthly reset

-- ── // 002  Plans reference table ───────────────────────────────────
create table if not exists plans (
  id                    text primary key,
  name                  text not null,
  monthly_tokens        bigint,
  markup_multiplier     decimal(3,2) default 1.3,
  rate_limit_per_minute int not null,
  daily_request_limit   int,
  price_monthly         decimal(6,2) default 0,
  support_level         text,
  features              jsonb,
  stripe_price_id       text
);

insert into plans (id, name, monthly_tokens, markup_multiplier, rate_limit_per_minute, daily_request_limit, price_monthly, support_level, features) values
('free', 'Free',          50000,    1.0, 10,  200,   0,  'email_48h',           '{"models":["cheap","fast"],"dashboard":"basic","caching":false,"csv_export":false,"team_members":1}'),
('payg', 'Pay-as-you-go', null,     1.3, 60,  10000, 0,  'email_24h',           '{"models":["cheap","fast","quality"],"dashboard":"full","caching":false,"csv_export":false,"team_members":1}'),
('pro',  'Pro',           10000000, 1.0, 300, null,  50, 'priority_4h_discord', '{"models":["cheap","fast","quality","early_access"],"dashboard":"full","caching":true,"csv_export":true,"team_members":3}')
on conflict (id) do update set
  name = excluded.name,
  monthly_tokens = excluded.monthly_tokens,
  markup_multiplier = excluded.markup_multiplier,
  rate_limit_per_minute = excluded.rate_limit_per_minute,
  daily_request_limit = excluded.daily_request_limit,
  price_monthly = excluded.price_monthly,
  support_level = excluded.support_level,
  features = excluded.features;

-- ── // 003  Modify usage_logs table ─────────────────────────────────
alter table usage_logs
  add column if not exists tier           text,
  add column if not exists markup_applied decimal(3,2),
  add column if not exists base_cost      decimal(10,6),
  add column if not exists final_cost     decimal(10,6),
  add column if not exists billed_from    text;  -- allowance | balance | included | overage

-- ── // 004  Transactions table (Stripe payments) ────────────────────
create table if not exists transactions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references users(id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_invoice_id        text,
  amount                   decimal(10,2) not null,
  currency                 text default 'usd',
  status                   text default 'pending',
  type                     text check (type in ('subscription','top_up','overage','refund','trial')),
  description              text,
  created_at               timestamptz default now()
);

-- ── // 005  API keys (gateway auth for the aggregator) ──────────────
-- Each key authenticates inbound API calls that get metered by /api/usage.
create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  key_prefix  text not null,            -- shown in UI, e.g. pk_live_AbC1
  key_hash    text not null,            -- sha256 of the full key
  name        text default 'default',
  last_used_at timestamptz,
  revoked     boolean default false,
  created_at  timestamptz default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────
create index if not exists idx_usage_logs_user_date  on usage_logs(user_id, created_at desc);
create index if not exists idx_transactions_user      on transactions(user_id, created_at desc);
create index if not exists idx_api_keys_hash          on api_keys(key_hash);
