-- MainStreetAI Supabase schema (Phase 7)
create extension if not exists pgcrypto;

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_id text not null,
  business_name text not null,
  location text not null,
  type text not null,
  voice text not null,
  audiences jsonb not null default '[]'::jsonb,
  products_or_services jsonb not null default '[]'::jsonb,
  hours text not null,
  typical_rush_times text not null,
  slow_hours text not null,
  offers_we_can_use jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists brands_owner_brand_id_unique
  on public.brands(owner_id, brand_id);

create table if not exists public.history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  endpoint text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  posted_at timestamptz not null,
  media_type text not null,
  caption_used text not null,
  promo_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  post_ref uuid references public.posts(id) on delete set null,
  window text not null,
  views int,
  likes int,
  comments int,
  shares int,
  saves int,
  clicks int,
  redemptions int,
  sales_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  title text not null,
  platform text not null,
  scheduled_for timestamptz not null,
  caption text not null,
  asset_notes text not null default '',
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.local_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('recurring', 'oneoff')),
  name text not null,
  pattern text,
  event_date date,
  event_time text,
  audience text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  provider text not null check (provider in ('buffer','meta','twilio','gmail','sendgrid','google_business')),
  status text not null default 'connected',
  config jsonb not null default '{}'::jsonb,
  secrets_enc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  type text not null check (type in ('post_publish','sms_send','gbp_post','email_send')),
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued','sent','failed')),
  attempts int not null default 0,
  last_error text,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists history_owner_brand_created_at_idx
  on public.history(owner_id, brand_ref, created_at desc);

create index if not exists posts_owner_brand_posted_at_idx
  on public.posts(owner_id, brand_ref, posted_at desc);

create index if not exists schedule_owner_brand_scheduled_for_idx
  on public.schedule(owner_id, brand_ref, scheduled_for);

create index if not exists local_events_owner_brand_event_date_idx
  on public.local_events(owner_id, brand_ref, event_date);

create unique index if not exists integrations_owner_brand_provider_unique
  on public.integrations(owner_id, brand_ref, provider);

create index if not exists outbox_owner_brand_scheduled_idx
  on public.outbox(owner_id, brand_ref, scheduled_for, status, created_at);

-- Keep updated_at fresh on brands updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

drop trigger if exists outbox_set_updated_at on public.outbox;
create trigger outbox_set_updated_at
before update on public.outbox
for each row execute function public.set_updated_at();

-- RLS: owner can only access own rows.
alter table public.brands enable row level security;
alter table public.history enable row level security;
alter table public.posts enable row level security;
alter table public.metrics enable row level security;
alter table public.schedule enable row level security;
alter table public.local_events enable row level security;
alter table public.integrations enable row level security;
alter table public.outbox enable row level security;

drop policy if exists brands_owner_select on public.brands;
create policy brands_owner_select on public.brands
for select using (owner_id = auth.uid());

drop policy if exists brands_owner_insert on public.brands;
create policy brands_owner_insert on public.brands
for insert with check (owner_id = auth.uid());

drop policy if exists brands_owner_update on public.brands;
create policy brands_owner_update on public.brands
for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists brands_owner_delete on public.brands;
create policy brands_owner_delete on public.brands
for delete using (owner_id = auth.uid());

drop policy if exists history_owner_all on public.history;
create policy history_owner_all on public.history
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists posts_owner_all on public.posts;
create policy posts_owner_all on public.posts
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists metrics_owner_all on public.metrics;
create policy metrics_owner_all on public.metrics
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists schedule_owner_all on public.schedule;
create policy schedule_owner_all on public.schedule
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists local_events_owner_all on public.local_events;
create policy local_events_owner_all on public.local_events
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists integrations_owner_all on public.integrations;
create policy integrations_owner_all on public.integrations
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists outbox_owner_all on public.outbox;
create policy outbox_owner_all on public.outbox
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());
