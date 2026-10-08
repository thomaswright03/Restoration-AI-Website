-- Room Designer 3D: database tables. Run once in the Supabase dashboard
-- (SQL Editor > New query > paste > Run). Safe to re-run.
--
-- businesses     one per account: the profile the designer shows
-- subscriptions  written only by api/stripe-webhook.js (service role)
-- leads          homeowner requests, written only by api/leads.js
-- projects       designs a subscriber saved, written only by api/projects.js
-- project_creations  one row per project ever created, never deleted, so the
--                monthly allowance counts projects that were later deleted
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

-- prices: the owner's labor prices, shown publicly by their designer. Kept a
-- small object so nobody can park a huge blob behind their public profile.
alter table public.businesses drop constraint if exists businesses_prices_object;
alter table public.businesses add constraint businesses_prices_object
  check (jsonb_typeof(prices) = 'object' and octet_length(prices::text) <= 4000);

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
-- starter | pro | max: which plan the subscription is on (api/_plans.js).
-- Filled by the Stripe webhook; can also be set by hand in Table Editor.
alter table public.subscriptions add column if not exists plan text;

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

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- The design as js/room-plan.js encode() writes it (base64url).
  design text not null default '' check (char_length(design) <= 20000 and design ~ '^[A-Za-z0-9_-]*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_updated on public.projects (owner_id, updated_at desc);
-- info: the client and the job (client name, address, phone, status...),
-- checked field by field in api/projects.js. summary: the estimate and
-- materials list as the designer worked them out when the project was saved.
alter table public.projects add column if not exists info jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists summary jsonb;
alter table public.projects drop constraint if exists projects_info_object;
alter table public.projects add constraint projects_info_object
  check (jsonb_typeof(info) = 'object' and octet_length(info::text) <= 8000);
alter table public.projects drop constraint if exists projects_summary_size;
alter table public.projects add constraint projects_summary_size
  check (summary is null or (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 100000));

create table if not exists public.project_creations (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists project_creations_owner_created on public.project_creations (owner_id, created_at);

alter table public.businesses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.leads enable row level security;
alter table public.projects enable row level security;
alter table public.project_creations enable row level security;

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

-- Projects: owners can read their own from the browser; creating, saving,
-- renaming and deleting go through api/projects.js, which checks the plan.
drop policy if exists "owner reads projects" on public.projects;
create policy "owner reads projects" on public.projects
  for select using (owner_id = auth.uid());

-- Creates a project if the plan's limits allow it, in one transaction: a
-- per-owner lock stops two saves at once from both slipping under a limit.
-- The month is the calendar month in UTC. Only the server can call it.
drop function if exists public.create_project(uuid, text, text, integer, integer);
create or replace function public.create_project(
  p_owner uuid, p_name text, p_design text, p_monthly integer, p_total integer,
  p_info jsonb default '{}'::jsonb, p_summary jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  used_month integer;
  used_total integer;
  created public.projects;
begin
  perform pg_advisory_xact_lock(hashtext('create_project:' || p_owner::text));
  select count(*) into used_month from public.project_creations
    where owner_id = p_owner and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
  select count(*) into used_total from public.projects where owner_id = p_owner;
  if used_month >= p_monthly then
    return jsonb_build_object('error', 'monthly-limit', 'month', used_month, 'total', used_total);
  end if;
  if used_total >= p_total then
    return jsonb_build_object('error', 'total-limit', 'month', used_month, 'total', used_total);
  end if;
  insert into public.projects (owner_id, name, design, info, summary)
    values (p_owner, p_name, p_design, coalesce(p_info, '{}'::jsonb), p_summary)
    returning * into created;
  insert into public.project_creations (owner_id) values (p_owner);
  return jsonb_build_object(
    'project', jsonb_build_object('id', created.id, 'name', created.name, 'info', created.info,
      'created_at', created.created_at, 'updated_at', created.updated_at),
    'month', used_month + 1, 'total', used_total + 1);
end;
$$;
revoke all on function public.create_project(uuid, text, text, integer, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_project(uuid, text, text, integer, integer, jsonb, jsonb) to service_role;
