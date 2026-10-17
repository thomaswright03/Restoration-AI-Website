-- Room Designer 3D: database tables. Run once in the Supabase dashboard
-- (SQL Editor > New query > paste > Run). Safe to re-run.
--
-- businesses     one per account: the profile the designer shows
-- subscriptions  written only by api/stripe-webhook.js (service role)
-- leads          homeowner requests, written only by api/leads.js
-- projects       designs a subscriber saved, written only by api/projects.js
-- project_creations  one row per project ever created, never deleted, so the
--                monthly allowance counts projects that were later deleted
-- used_trials    a SHA-256 of each email that had the free week or a plan,
--                so the same person gets one free trial (api/checkout.js)
--
-- Row-level security lets a signed-in owner read and edit their own rows
-- from the browser; everything else goes through the api/ functions.
--
-- Every table hangs off auth.users with "on delete cascade" (leads through
-- businesses), so deleting the auth user (api/account.js, "Delete account")
-- removes the business, its leads, the subscription row and all projects.
-- used_trials alone outlives the account, by design (one free trial per email).

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
-- The free week: when it ends. Set once, at sign-up, by grant_free_week()
-- below; until then the account counts as Starter (api/_plans.js). The
-- Stripe webhook never writes it, so a paid plan doesn't clear it.
alter table public.subscriptions add column if not exists free_week_ends timestamptz;
-- Retired: the old "Put it on your website" add-on. Nothing reads or writes
-- it any more (a business's designer opens only for its owner); kept so
-- existing databases don't need a destructive change.
alter table public.subscriptions add column if not exists website boolean not null default false;

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

-- Kill switch (api/_switches.js). One row; flip a column to false in Table
-- Editor to stop that part of the product without a deploy, true to resume:
--   signups   new accounts (the sign-up page hides its form; the trigger below
--             refuses the account even if a request gets past the page)
--   checkout  buying a plan (api/checkout.js answers 503 {error: "paused"})
--   saving    saving a project's design (api/projects.js answers 503 {error: "paused"})
--   notice    a short message shown on the account and sign-up pages while not empty
-- The API caches the row for 15 seconds. Only the server reads it.
-- used_trials: one row per email whose account had a Stripe subscription
-- and was then deleted, so making a new account with the same email doesn't
-- bring another free trial (api/checkout.js). Only a SHA-256 of the trimmed,
-- lower-cased email is kept, never the email. Written by the trigger below,
-- read only by the server.
create table if not exists public.used_trials (
  email_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.used_trials enable row level security;
revoke all on public.used_trials from anon, authenticated;

create or replace function public.remember_used_trial()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.email is not null and exists (
    select 1 from public.subscriptions s
    where s.owner_id = old.id and s.stripe_subscription_id is not null
  ) then
    insert into public.used_trials (email_hash)
    values (encode(digest(lower(trim(old.email)), 'sha256'), 'hex'))
    on conflict (email_hash) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.remember_used_trial() from public, anon, authenticated;
grant execute on function public.remember_used_trial() to supabase_auth_admin;
-- BEFORE delete: the subscriptions row is still there (the cascade runs after).
drop trigger if exists remember_used_trial on auth.users;
create trigger remember_used_trial
  before delete on auth.users
  for each row execute function public.remember_used_trial();

create table if not exists public.site_switches (
  id smallint primary key default 1 check (id = 1),
  signups boolean not null default true,
  checkout boolean not null default true,
  saving boolean not null default true,
  notice text not null default '' check (char_length(notice) <= 500),
  updated_at timestamptz not null default now()
);
insert into public.site_switches (id) values (1) on conflict (id) do nothing;
alter table public.site_switches enable row level security;
revoke all on public.site_switches from anon, authenticated;

-- With signups off, Supabase Auth refuses to create the user (the sign-up
-- request fails), so the switch holds even for a request made outside the
-- page. Runs as the function's owner, so the auth service needs no rights on
-- the table itself.
create or replace function public.refuse_signup_when_paused()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.site_switches where id = 1 and signups = false) then
    raise exception 'signups-paused' using hint = 'New sign-ups are paused (site_switches.signups).';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_signup_when_paused() from public, anon, authenticated;
grant execute on function public.refuse_signup_when_paused() to supabase_auth_admin;
drop trigger if exists refuse_signup_when_paused on auth.users;
create trigger refuse_signup_when_paused
  before insert on auth.users
  for each row execute function public.refuse_signup_when_paused();

-- The free week: every new account gets Starter for 7 days, with no card
-- and no payment (api/_plans.js). Once per person: the email's key (no
-- +tag, no Gmail dots; api/_subscriptions.js emailKey() does the same) is
-- hashed into used_trials when the week is given, so a second account with
-- the same or a dressed-up email, or a deleted and re-made one, gets none.
-- Anything going wrong here never stops the sign-up itself.
create or replace function public.email_key(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  at_pos integer := length(e) - strpos(reverse(e), '@') + 1;
  local text;
  domain text;
begin
  if strpos(e, '@') < 2 then
    return e;
  end if;
  local := split_part(substr(e, 1, at_pos - 1), '+', 1);
  domain := substr(e, at_pos + 1);
  if domain in ('gmail.com', 'googlemail.com') then
    local := replace(local, '.', '');
    domain := 'gmail.com';
  end if;
  return local || '@' || domain;
end;
$$;

create or replace function public.grant_free_week()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_hash text;
  key_hash text;
  claimed integer;
begin
  if new.email is null or trim(new.email) = '' then
    return new;
  end if;
  raw_hash := encode(digest(lower(trim(new.email)), 'sha256'), 'hex');
  key_hash := encode(digest(public.email_key(new.email), 'sha256'), 'hex');
  if exists (select 1 from public.used_trials where email_hash in (raw_hash, key_hash)) then
    return new;
  end if;
  insert into public.used_trials (email_hash) values (key_hash) on conflict (email_hash) do nothing;
  get diagnostics claimed = row_count;
  if claimed = 1 then
    insert into public.subscriptions (owner_id, free_week_ends)
      values (new.id, now() + interval '7 days')
      on conflict (owner_id) do nothing;
  end if;
  return new;
exception when others then
  raise warning 'grant_free_week: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.grant_free_week() from public, anon, authenticated;
grant execute on function public.grant_free_week() to supabase_auth_admin;
drop trigger if exists grant_free_week on auth.users;
create trigger grant_free_week
  after insert on auth.users
  for each row execute function public.grant_free_week();
