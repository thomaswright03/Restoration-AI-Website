-- Room Designer 3D: database tables. Run once in the Supabase dashboard
-- (SQL Editor > New query > paste > Run). Safe to re-run.
--
-- businesses     one per account: the profile the designer shows
-- subscriptions  written only by api/stripe-webhook.js (service role)
-- leads          homeowner requests, written only by api/leads.js
--
-- Row-level security lets a signed-in owner read and edit their own rows
-- from the browser; everything else goes through the api/ functions.

create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' and slug <> 'demo'),
  name text not null check (char_length(name) between 1 and 120),
  phone text not null default '' check (char_length(phone) <= 40),
  email text not null default '' check (char_length(email) <= 160),
  legal_name text not null default '' check (char_length(legal_name) <= 160),
  prices jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'none',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  service text not null default '',
  message text not null default '',
  language text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists leads_business_created on public.leads (business_id, created_at desc);

alter table public.businesses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.leads enable row level security;

drop policy if exists "owner reads business" on public.businesses;
create policy "owner reads business" on public.businesses
  for select using (owner_id = auth.uid());
drop policy if exists "owner creates business" on public.businesses;
create policy "owner creates business" on public.businesses
  for insert with check (owner_id = auth.uid());
drop policy if exists "owner updates business" on public.businesses;
create policy "owner updates business" on public.businesses
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "owner reads subscription" on public.subscriptions;
create policy "owner reads subscription" on public.subscriptions
  for select using (owner_id = auth.uid());

drop policy if exists "owner reads leads" on public.leads;
create policy "owner reads leads" on public.leads
  for select using (
    exists (select 1 from public.businesses b where b.id = leads.business_id and b.owner_id = auth.uid())
  );
drop policy if exists "owner deletes leads" on public.leads;
create policy "owner deletes leads" on public.leads
  for delete using (
    exists (select 1 from public.businesses b where b.id = leads.business_id and b.owner_id = auth.uid())
  );
