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
  community_vibe_profile jsonb not null default '{"localTone":"neighborly","collaborationLevel":"medium","localIdentityTags":[],"audienceStyle":"mixed","avoidCorporateTone":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brands
  add column if not exists community_vibe_profile jsonb not null
  default '{"localTone":"neighborly","collaborationLevel":"medium","localIdentityTags":[],"audienceStyle":"mixed","avoidCorporateTone":true}'::jsonb;

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
  status text not null default 'posted',
  promo_name text,
  notes text,
  provider_meta jsonb,
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
  type text not null check (type in ('post_publish','sms_send','sms_campaign','gbp_post','email_send')),
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued','sent','failed')),
  attempts int not null default 0,
  last_error text,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sms_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  phone text not null,
  name text,
  tags jsonb not null default '[]'::jsonb,
  opted_in boolean not null default true,
  consent_source text,
  created_at timestamptz not null default now()
);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  to_phone text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_message_id text,
  error text,
  purpose text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.email_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  to_email text not null,
  cadence text not null check (cadence in ('daily','weekly')),
  day_of_week int check (day_of_week between 0 and 6),
  hour int check (hour between 0 and 23),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  to_email text not null,
  subject text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_id text,
  error text,
  subscription_id uuid references public.email_subscriptions(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.autopilot_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  enabled boolean not null default false,
  cadence text not null default 'daily' check (cadence in ('daily', 'weekday', 'custom')),
  hour int not null default 7 check (hour between 0 and 23),
  timezone text not null default 'America/Chicago',
  goals jsonb not null default '["repeat_customers","slow_hours"]'::jsonb,
  focus_audiences jsonb not null default '[]'::jsonb,
  channels jsonb not null default '["facebook","instagram"]'::jsonb,
  allow_discounts boolean not null default true,
  max_discount_text text,
  notify_email text,
  notify_sms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.model_insights_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  range_days int not null default 30,
  insights jsonb not null,
  computed_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  type text not null check (type in ('slow_day','low_engagement','missed_post','spike','other')),
  severity text not null check (severity in ('info','warning','urgent')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  status text not null default 'inactive' check (status in ('inactive','trialing','active','past_due','canceled','unpaid')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now()
);

create table if not exists public.brand_voice_samples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  source text not null check (source in ('caption','sms','email','manual')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.brand_voice_profile (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  embedding jsonb,
  style_summary text,
  emoji_style text,
  energy_level text check (energy_level in ('calm','friendly','hype','luxury')),
  phrases_to_repeat text[] not null default '{}'::text[],
  do_not_use text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  name text not null,
  address text,
  timezone text not null default 'America/Chicago',
  google_location_name text,
  buffer_profile_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text,
  domain text,
  logo_url text,
  primary_color text,
  support_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_branding (
  id uuid primary key default gen_random_uuid(),
  tenant_ref uuid not null references public.tenants(id) on delete cascade,
  app_name text not null default 'MainStreetAI',
  tagline text,
  hide_mainstreetai_branding boolean not null default false
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  location_ref uuid references public.locations(id) on delete set null,
  kind text not null check (kind in ('image','video','thumbnail')),
  source text not null check (source in ('upload','url','generated')),
  url text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table if not exists public.media_analysis (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  asset_ref uuid not null references public.media_assets(id) on delete cascade,
  platform text not null,
  analysis jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.post_timing_model (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  model jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.posts add column if not exists status text not null default 'posted';
alter table public.posts add column if not exists provider_meta jsonb;
alter table public.subscriptions add column if not exists tenant_ref uuid references public.tenants(id) on delete set null;
alter table public.brand_voice_profile add column if not exists phrases_to_repeat text[] not null default '{}'::text[];
alter table public.brand_voice_profile add column if not exists do_not_use text[] not null default '{}'::text[];

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

create unique index if not exists sms_contacts_owner_brand_phone_unique
  on public.sms_contacts(owner_id, brand_ref, phone);

create index if not exists sms_messages_owner_brand_created_idx
  on public.sms_messages(owner_id, brand_ref, created_at desc);

create unique index if not exists email_subscriptions_owner_brand_to_email_unique
  on public.email_subscriptions(owner_id, brand_ref, to_email);

create index if not exists email_subscriptions_due_idx
  on public.email_subscriptions(owner_id, cadence, day_of_week, hour, enabled);

create index if not exists email_log_owner_brand_created_idx
  on public.email_log(owner_id, brand_ref, created_at desc);

create unique index if not exists autopilot_settings_owner_brand_unique
  on public.autopilot_settings(owner_id, brand_ref);

create index if not exists autopilot_settings_due_idx
  on public.autopilot_settings(owner_id, enabled, hour, cadence, timezone);

create unique index if not exists model_insights_cache_owner_brand_range_unique
  on public.model_insights_cache(owner_id, brand_ref, range_days);

create index if not exists alerts_owner_brand_created_idx
  on public.alerts(owner_id, brand_ref, created_at desc);

create unique index if not exists subscriptions_owner_brand_unique
  on public.subscriptions(owner_id, brand_ref);

create index if not exists subscriptions_owner_brand_status_idx
  on public.subscriptions(owner_id, brand_ref, status, plan);

create unique index if not exists team_members_owner_brand_user_unique
  on public.team_members(owner_id, brand_ref, user_id);

create index if not exists team_members_brand_user_idx
  on public.team_members(brand_ref, user_id, role);

create index if not exists brand_voice_samples_owner_brand_created_idx
  on public.brand_voice_samples(owner_id, brand_ref, created_at desc);

create unique index if not exists brand_voice_profile_owner_brand_unique
  on public.brand_voice_profile(owner_id, brand_ref);

create unique index if not exists locations_brand_name_unique
  on public.locations(brand_ref, name);

create index if not exists locations_owner_brand_created_idx
  on public.locations(owner_id, brand_ref, created_at desc);

create unique index if not exists tenants_owner_unique
  on public.tenants(owner_id);

create unique index if not exists tenants_domain_unique
  on public.tenants(domain);

create unique index if not exists tenant_branding_tenant_unique
  on public.tenant_branding(tenant_ref);

create index if not exists subscriptions_owner_tenant_status_idx
  on public.subscriptions(owner_id, tenant_ref, status, plan);

create index if not exists media_assets_owner_brand_created_idx
  on public.media_assets(owner_id, brand_ref, created_at desc);

create index if not exists media_assets_owner_brand_kind_idx
  on public.media_assets(owner_id, brand_ref, kind, created_at desc);

create index if not exists media_analysis_owner_brand_created_idx
  on public.media_analysis(owner_id, brand_ref, created_at desc);

create index if not exists media_analysis_asset_ref_idx
  on public.media_analysis(owner_id, asset_ref, created_at desc);

create unique index if not exists post_timing_model_owner_brand_platform_unique
  on public.post_timing_model(owner_id, brand_ref, platform);

create index if not exists post_timing_model_owner_brand_computed_idx
  on public.post_timing_model(owner_id, brand_ref, computed_at desc);

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

drop trigger if exists autopilot_settings_set_updated_at on public.autopilot_settings;
create trigger autopilot_settings_set_updated_at
before update on public.autopilot_settings
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists brand_voice_profile_set_updated_at on public.brand_voice_profile;
create trigger brand_voice_profile_set_updated_at
before update on public.brand_voice_profile
for each row execute function public.set_updated_at();

create or replace function public.is_brand_owner(_brand_ref uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.brands b
    where b.id = _brand_ref
      and b.owner_id = auth.uid()
  );
$$;

create or replace function public.has_team_role(_brand_ref uuid, _roles text[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.brand_ref = _brand_ref
      and tm.user_id = auth.uid()
      and tm.role = any(_roles)
  );
$$;

create or replace function public.is_tenant_owner(_tenant_ref uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.tenants t
    where t.id = _tenant_ref
      and t.owner_id = auth.uid()
  );
$$;

-- RLS: owner can only access own rows.
alter table public.brands enable row level security;
alter table public.history enable row level security;
alter table public.posts enable row level security;
alter table public.metrics enable row level security;
alter table public.schedule enable row level security;
alter table public.local_events enable row level security;
alter table public.integrations enable row level security;
alter table public.outbox enable row level security;
alter table public.sms_contacts enable row level security;
alter table public.sms_messages enable row level security;
alter table public.email_subscriptions enable row level security;
alter table public.email_log enable row level security;
alter table public.autopilot_settings enable row level security;
alter table public.model_insights_cache enable row level security;
alter table public.alerts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.team_members enable row level security;
alter table public.brand_voice_samples enable row level security;
alter table public.brand_voice_profile enable row level security;
alter table public.locations enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_branding enable row level security;
alter table public.media_assets enable row level security;
alter table public.media_analysis enable row level security;
alter table public.post_timing_model enable row level security;

drop policy if exists brands_owner_select on public.brands;
create policy brands_owner_select on public.brands
for select using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.team_members tm
    where tm.brand_ref = id
      and tm.user_id = auth.uid()
  )
);

drop policy if exists brands_owner_insert on public.brands;
create policy brands_owner_insert on public.brands
for insert with check (owner_id = auth.uid());

drop policy if exists brands_owner_update on public.brands;
create policy brands_owner_update on public.brands
for update using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.team_members tm
    where tm.brand_ref = id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
  )
)
with check (owner_id = auth.uid());

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

drop policy if exists sms_contacts_owner_all on public.sms_contacts;
create policy sms_contacts_owner_all on public.sms_contacts
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists sms_messages_owner_all on public.sms_messages;
create policy sms_messages_owner_all on public.sms_messages
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists email_subscriptions_owner_all on public.email_subscriptions;
create policy email_subscriptions_owner_all on public.email_subscriptions
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists email_log_owner_all on public.email_log;
create policy email_log_owner_all on public.email_log
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists autopilot_settings_owner_all on public.autopilot_settings;
create policy autopilot_settings_owner_all on public.autopilot_settings
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists model_insights_cache_owner_all on public.model_insights_cache;
create policy model_insights_cache_owner_all on public.model_insights_cache
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists alerts_owner_all on public.alerts;
create policy alerts_owner_all on public.alerts
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists subscriptions_owner_select on public.subscriptions;
create policy subscriptions_owner_select on public.subscriptions
for select
using (
  owner_id = auth.uid()
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists subscriptions_owner_modify on public.subscriptions;
create policy subscriptions_owner_modify on public.subscriptions
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
for select
using (
  owner_id = auth.uid()
  or user_id = auth.uid()
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members
for insert
with check (
  owner_id = auth.uid()
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists team_members_update on public.team_members;
create policy team_members_update on public.team_members
for update
using (
  owner_id = auth.uid()
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
)
with check (
  owner_id = auth.uid()
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members
for delete
using (
  owner_id = auth.uid()
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists brand_voice_samples_owner_all on public.brand_voice_samples;
create policy brand_voice_samples_owner_all on public.brand_voice_samples
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists brand_voice_profile_owner_all on public.brand_voice_profile;
create policy brand_voice_profile_owner_all on public.brand_voice_profile
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists locations_owner_all on public.locations;
create policy locations_owner_all on public.locations
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists tenants_owner_all on public.tenants;
create policy tenants_owner_all on public.tenants
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists tenant_branding_owner_all on public.tenant_branding;
create policy tenant_branding_owner_all on public.tenant_branding
for all
using (public.is_tenant_owner(tenant_ref))
with check (public.is_tenant_owner(tenant_ref));

drop policy if exists media_assets_owner_all on public.media_assets;
create policy media_assets_owner_all on public.media_assets
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists media_analysis_owner_all on public.media_analysis;
create policy media_analysis_owner_all on public.media_analysis
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists post_timing_model_owner_all on public.post_timing_model;
create policy post_timing_model_owner_all on public.post_timing_model
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

alter table public.outbox drop constraint if exists outbox_type_check;
alter table public.outbox add constraint outbox_type_check
check (type in ('post_publish','sms_send','sms_campaign','gbp_post','email_send'));
