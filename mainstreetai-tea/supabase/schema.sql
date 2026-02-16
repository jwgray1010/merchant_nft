-- MainStreetAI Supabase schema (Phase 7)
create extension if not exists pgcrypto;

create table if not exists public.towns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);

create table if not exists public.town_profiles (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  greeting_style text not null default 'warm and neighborly',
  community_focus text not null default 'support local families and small businesses',
  seasonal_priority text not null default 'school events and seasonal community rhythms',
  school_integration_enabled boolean not null default true,
  sponsorship_style text not null default 'community-first local sponsorship',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_id text not null,
  business_name text not null,
  location text not null,
  status text not null default 'active' check (status in ('active','inactive','closed')),
  status_reason text,
  status_updated_at timestamptz,
  status_updated_by uuid references auth.users(id) on delete set null,
  town_ref uuid references public.towns(id) on delete set null,
  support_level text not null default 'steady' check (support_level in ('growing_fast','steady','struggling','just_starting')),
  local_trust_enabled boolean not null default true,
  local_trust_style text not null default 'mainstreet' check (local_trust_style in ('mainstreet','network')),
  contact_preference text check (contact_preference in ('sms','email')),
  contact_phone text,
  contact_email text,
  event_contact_preference text check (event_contact_preference in ('sms','email')),
  service_tags jsonb not null default '[]'::jsonb,
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

alter table public.brands
  add column if not exists town_ref uuid references public.towns(id) on delete set null;

alter table public.brands
  add column if not exists support_level text not null default 'steady';

alter table public.brands
  add column if not exists local_trust_enabled boolean not null default true;

alter table public.brands
  add column if not exists local_trust_style text not null default 'mainstreet';

alter table public.brands
  add column if not exists service_tags jsonb not null default '[]'::jsonb;

alter table public.brands
  add column if not exists status text not null default 'active';

alter table public.brands
  add column if not exists status_reason text;

alter table public.brands
  add column if not exists status_updated_at timestamptz;

alter table public.brands
  add column if not exists status_updated_by uuid references auth.users(id) on delete set null;

alter table public.brands
  add column if not exists contact_preference text;

alter table public.brands
  add column if not exists contact_phone text;

alter table public.brands
  add column if not exists contact_email text;

alter table public.brands
  add column if not exists event_contact_preference text;

alter table public.brands
  drop constraint if exists brands_support_level_check;

alter table public.brands
  add constraint brands_support_level_check
  check (support_level in ('growing_fast','steady','struggling','just_starting'));

alter table public.brands
  drop constraint if exists brands_local_trust_style_check;

alter table public.brands
  add constraint brands_local_trust_style_check
  check (local_trust_style in ('mainstreet','network'));

alter table public.brands
  drop constraint if exists brands_status_check;

alter table public.brands
  add constraint brands_status_check
  check (status in ('active','inactive','closed'));

alter table public.brands
  drop constraint if exists brands_contact_preference_check;

alter table public.brands
  add constraint brands_contact_preference_check
  check (contact_preference is null or contact_preference in ('sms','email'));

alter table public.brands
  drop constraint if exists brands_event_contact_preference_check;

alter table public.brands
  add constraint brands_event_contact_preference_check
  check (event_contact_preference is null or event_contact_preference in ('sms','email'));

create unique index if not exists brands_owner_brand_id_unique
  on public.brands(owner_id, brand_id);

create index if not exists brands_town_status_updated_idx
  on public.brands(town_ref, status, updated_at desc);

create unique index if not exists town_profiles_town_ref_unique
  on public.town_profiles(town_ref);

create index if not exists town_profiles_town_updated_idx
  on public.town_profiles(town_ref, updated_at desc);

create table if not exists public.town_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  town_ref uuid not null references public.towns(id) on delete cascade,
  participation_level text not null default 'standard' check (participation_level in ('standard','leader','hidden')),
  created_at timestamptz not null default now()
);

create table if not exists public.town_rotations (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  last_featured timestamptz not null default now()
);

create table if not exists public.town_pulse_signals (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  category text not null check (category in ('cafe','fitness','salon','retail','service','food','mixed')),
  signal_type text not null check (signal_type in ('busy','slow','event_spike','post_success')),
  day_of_week int check (day_of_week between 0 and 6),
  hour int check (hour between 0 and 23),
  weight numeric not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.town_pulse_model (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  model jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create table if not exists public.town_stories (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  story_type text not null check (story_type in ('weekly','daily','event')),
  content jsonb not null,
  generated_at timestamptz not null default now()
);

create table if not exists public.town_story_usage (
  id uuid primary key default gen_random_uuid(),
  town_story_ref uuid not null references public.town_stories(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  used_at timestamptz not null default now()
);

create table if not exists public.town_graph_edges (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  from_category text not null check (from_category in ('cafe','fitness','salon','retail','service','food','other')),
  to_category text not null check (to_category in ('cafe','fitness','salon','retail','service','food','other')),
  weight numeric not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.town_graph_suggestions (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  category text not null check (category in ('cafe','fitness','salon','retail','service','food','other')),
  suggestions jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create table if not exists public.brand_partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  partner_brand_ref uuid not null references public.brands(id) on delete cascade,
  relationship text not null default 'partner' check (relationship in ('partner','favorite','sponsor')),
  created_at timestamptz not null default now()
);

create table if not exists public.town_micro_routes (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  window text not null check (window in ('morning','lunch','after_work','evening','weekend')),
  routes jsonb not null default '{"topRoutes":[]}'::jsonb,
  computed_at timestamptz not null default now()
);

create table if not exists public.town_seasons (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  season_key text not null check (season_key in ('winter','spring','summer','fall','holiday','school','football','basketball','baseball','festival')),
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.town_route_season_weights (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  season_tag text not null check (season_tag in ('winter','spring','summer','fall','holiday','school','football','basketball','baseball','festival')),
  window text not null check (window in ('morning','lunch','after_work','evening','weekend')),
  from_category text not null check (from_category in ('cafe','fitness','salon','retail','service','food','other')),
  to_category text not null check (to_category in ('cafe','fitness','salon','retail','service','food','other')),
  weight_delta numeric not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.community_sponsors (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  sponsor_name text not null,
  role text not null default 'nonprofit' check (role in ('chamber','bank','downtown_org','nonprofit')),
  sponsored_seats int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.community_sponsors add column if not exists role text;
alter table public.community_sponsors alter column role set default 'nonprofit';
update public.community_sponsors set role = 'nonprofit' where role is null;
alter table public.community_sponsors alter column role set not null;
alter table public.community_sponsors
  drop constraint if exists community_sponsors_role_check;
alter table public.community_sponsors
  add constraint community_sponsors_role_check
  check (role in ('chamber','bank','downtown_org','nonprofit'));

create table if not exists public.sponsored_memberships (
  id uuid primary key default gen_random_uuid(),
  sponsor_ref uuid not null references public.community_sponsors(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','ended')),
  created_at timestamptz not null default now()
);

create table if not exists public.town_ambassadors (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  role text not null default 'ambassador' check (role in ('ambassador','local_leader','organizer')),
  joined_at timestamptz not null default now()
);

create table if not exists public.town_invites (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  invited_business text not null,
  invited_by_brand_ref uuid not null references public.brands(id) on delete cascade,
  category text not null default 'other',
  invite_code text not null default encode(gen_random_bytes(6), 'hex'),
  contact_preference text check (contact_preference in ('sms','email')),
  invited_phone text,
  invited_email text,
  status text not null default 'pending' check (status in ('pending','sent','accepted','declined')),
  created_at timestamptz not null default now()
);

alter table public.town_invites
  add column if not exists invite_code text;

update public.town_invites
set invite_code = substring(replace(id::text, '-', ''), 1, 12)
where invite_code is null;

alter table public.town_invites
  alter column invite_code set not null;

alter table public.town_invites
  add column if not exists contact_preference text;

alter table public.town_invites
  add column if not exists invited_phone text;

alter table public.town_invites
  drop constraint if exists town_invites_contact_preference_check;

alter table public.town_invites
  add constraint town_invites_contact_preference_check
  check (contact_preference is null or contact_preference in ('sms','email'));

create table if not exists public.town_success_signals (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  signal text not null check (signal in ('busy_days_up','repeat_customers_up','new_faces_seen')),
  weight numeric not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.town_board_posts (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  source text not null,
  title text not null,
  description text not null default '',
  event_date timestamptz not null,
  needs jsonb not null default '[]'::jsonb,
  contact_info text not null,
  signup_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  town_ref uuid not null references public.towns(id) on delete cascade,
  source text not null check (source in ('chamber','school','youth','nonprofit')),
  title text not null,
  description text not null default '',
  event_date timestamptz not null,
  needs jsonb not null default '[]'::jsonb,
  signup_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_interest (
  id uuid primary key default gen_random_uuid(),
  brand_ref uuid not null references public.brands(id) on delete cascade,
  event_ref uuid not null references public.community_events(id) on delete cascade,
  interest_type text not null check (interest_type in ('cater','sponsor','assist')),
  created_at timestamptz not null default now()
);

create table if not exists public.first_win_sessions (
  id uuid primary key default gen_random_uuid(),
  brand_ref uuid not null references public.brands(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed boolean not null default false,
  result_feedback text check (result_feedback in ('slow','okay','busy')),
  created_at timestamptz not null default now()
);

create table if not exists public.autopublicity_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_ref uuid not null references public.brands(id) on delete cascade,
  media_url text not null,
  status text not null default 'draft' check (status in ('draft','posting','posted')),
  created_at timestamptz not null default now()
);

create table if not exists public.owner_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_ref uuid not null references public.brands(id) on delete cascade,
  action_date date not null,
  action_type text not null check (action_type in ('daily_pack','post_now','rescue_used','story_used','camera_post')),
  created_at timestamptz not null default now()
);

create table if not exists public.owner_win_moments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.owner_progress
  drop constraint if exists owner_progress_action_type_check;
alter table public.owner_progress
  add constraint owner_progress_action_type_check
  check (action_type in ('daily_pack','post_now','rescue_used','story_used','camera_post'));

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

create unique index if not exists towns_name_region_unique
  on public.towns (lower(name), coalesce(lower(region), ''));

create unique index if not exists town_memberships_brand_ref_unique
  on public.town_memberships(brand_ref);

create index if not exists town_memberships_town_ref_idx
  on public.town_memberships(town_ref, participation_level, created_at);

create unique index if not exists town_rotations_town_brand_unique
  on public.town_rotations(town_ref, brand_ref);

create index if not exists town_rotations_town_last_featured_idx
  on public.town_rotations(town_ref, last_featured);

create index if not exists town_pulse_signals_town_created_idx
  on public.town_pulse_signals(town_ref, created_at desc);

create index if not exists town_pulse_signals_town_type_idx
  on public.town_pulse_signals(town_ref, signal_type, day_of_week, hour);

create unique index if not exists town_pulse_model_town_ref_unique
  on public.town_pulse_model(town_ref);

create index if not exists town_stories_town_generated_idx
  on public.town_stories(town_ref, generated_at desc);

create index if not exists town_stories_story_type_generated_idx
  on public.town_stories(story_type, generated_at desc);

create unique index if not exists town_story_usage_story_brand_unique
  on public.town_story_usage(town_story_ref, brand_ref);

create index if not exists town_story_usage_brand_used_idx
  on public.town_story_usage(brand_ref, used_at desc);

create unique index if not exists town_graph_edges_town_from_to_unique
  on public.town_graph_edges(town_ref, from_category, to_category);

create index if not exists town_graph_edges_town_weight_idx
  on public.town_graph_edges(town_ref, weight desc);

create unique index if not exists town_graph_suggestions_town_category_unique
  on public.town_graph_suggestions(town_ref, category);

create index if not exists town_graph_suggestions_town_computed_idx
  on public.town_graph_suggestions(town_ref, computed_at desc);

create unique index if not exists brand_partners_owner_brand_partner_unique
  on public.brand_partners(owner_id, brand_ref, partner_brand_ref);

create index if not exists brand_partners_owner_brand_created_idx
  on public.brand_partners(owner_id, brand_ref, created_at desc);

create unique index if not exists town_micro_routes_town_window_unique
  on public.town_micro_routes(town_ref, window);

create index if not exists town_micro_routes_town_computed_idx
  on public.town_micro_routes(town_ref, computed_at desc);

create unique index if not exists town_seasons_town_key_unique
  on public.town_seasons(town_ref, season_key);

create index if not exists town_seasons_town_created_idx
  on public.town_seasons(town_ref, created_at desc);

create unique index if not exists town_route_season_weights_unique
  on public.town_route_season_weights(town_ref, season_tag, window, from_category, to_category);

create index if not exists town_route_season_weights_town_window_idx
  on public.town_route_season_weights(town_ref, window, created_at desc);

create index if not exists community_sponsors_town_active_idx
  on public.community_sponsors(town_ref, active, created_at desc);

create unique index if not exists community_sponsors_town_name_unique
  on public.community_sponsors(town_ref, lower(sponsor_name));

create unique index if not exists sponsored_memberships_brand_ref_unique
  on public.sponsored_memberships(brand_ref);

create index if not exists sponsored_memberships_sponsor_status_idx
  on public.sponsored_memberships(sponsor_ref, status, created_at desc);

create unique index if not exists town_ambassadors_brand_ref_unique
  on public.town_ambassadors(brand_ref);

create index if not exists town_ambassadors_town_joined_idx
  on public.town_ambassadors(town_ref, joined_at desc);

create index if not exists town_invites_town_created_idx
  on public.town_invites(town_ref, created_at desc);

create index if not exists town_invites_town_status_idx
  on public.town_invites(town_ref, status, created_at desc);

create unique index if not exists town_invites_invite_code_unique
  on public.town_invites(invite_code);

create index if not exists town_invites_town_code_idx
  on public.town_invites(town_ref, invite_code);

create index if not exists town_success_signals_town_created_idx
  on public.town_success_signals(town_ref, created_at desc);

create index if not exists town_success_signals_town_signal_idx
  on public.town_success_signals(town_ref, signal, created_at desc);

create index if not exists town_board_posts_town_status_date_idx
  on public.town_board_posts(town_ref, status, event_date asc, created_at desc);

create index if not exists town_board_posts_status_created_idx
  on public.town_board_posts(status, created_at desc);

create index if not exists community_events_town_date_idx
  on public.community_events(town_ref, event_date asc, created_at desc);

create index if not exists community_events_town_source_idx
  on public.community_events(town_ref, source, event_date asc);

create unique index if not exists event_interest_brand_event_unique
  on public.event_interest(brand_ref, event_ref);

create index if not exists event_interest_event_created_idx
  on public.event_interest(event_ref, created_at desc);

create unique index if not exists owner_progress_owner_day_action_unique
  on public.owner_progress(owner_id, action_date, action_type);

create index if not exists owner_progress_owner_brand_day_idx
  on public.owner_progress(owner_id, brand_ref, action_date desc);

create index if not exists owner_win_moments_owner_created_idx
  on public.owner_win_moments(owner_id, created_at desc);

create index if not exists first_win_sessions_brand_created_idx
  on public.first_win_sessions(brand_ref, created_at desc);

create index if not exists first_win_sessions_brand_completed_idx
  on public.first_win_sessions(brand_ref, completed, created_at desc);

create index if not exists autopublicity_jobs_brand_created_idx
  on public.autopublicity_jobs(brand_ref, created_at desc);

create index if not exists autopublicity_jobs_brand_status_idx
  on public.autopublicity_jobs(brand_ref, status, created_at desc);

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

create or replace function public.is_town_member(_town_ref uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.brands b
    where b.town_ref = _town_ref
      and (
        b.owner_id = auth.uid()
        or public.has_team_role(b.id, array['owner','admin','member']::text[])
      )
  );
$$;

create or replace function public.same_town_brand_pair(_brand_ref uuid, _partner_brand_ref uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.brands b1
    join public.brands b2 on b2.id = _partner_brand_ref
    where b1.id = _brand_ref
      and b1.town_ref is not null
      and b1.town_ref = b2.town_ref
  );
$$;

alter table public.brand_partners drop constraint if exists brand_partners_not_self;
alter table public.brand_partners add constraint brand_partners_not_self
check (brand_ref <> partner_brand_ref);

alter table public.brand_partners drop constraint if exists brand_partners_same_town_check;
alter table public.brand_partners add constraint brand_partners_same_town_check
check (public.same_town_brand_pair(brand_ref, partner_brand_ref));

-- RLS: owner can only access own rows.
alter table public.brands enable row level security;
alter table public.towns enable row level security;
alter table public.town_profiles enable row level security;
alter table public.town_memberships enable row level security;
alter table public.town_rotations enable row level security;
alter table public.town_pulse_signals enable row level security;
alter table public.town_pulse_model enable row level security;
alter table public.town_stories enable row level security;
alter table public.town_story_usage enable row level security;
alter table public.town_graph_edges enable row level security;
alter table public.town_graph_suggestions enable row level security;
alter table public.brand_partners enable row level security;
alter table public.town_micro_routes enable row level security;
alter table public.town_seasons enable row level security;
alter table public.town_route_season_weights enable row level security;
alter table public.community_sponsors enable row level security;
alter table public.sponsored_memberships enable row level security;
alter table public.town_ambassadors enable row level security;
alter table public.town_invites enable row level security;
alter table public.town_success_signals enable row level security;
alter table public.town_board_posts enable row level security;
alter table public.community_events enable row level security;
alter table public.event_interest enable row level security;
alter table public.owner_progress enable row level security;
alter table public.owner_win_moments enable row level security;
alter table public.first_win_sessions enable row level security;
alter table public.autopublicity_jobs enable row level security;
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

drop policy if exists towns_member_select on public.towns;
create policy towns_member_select on public.towns
for select
using (
  exists (
    select 1
    from public.town_memberships tm
    join public.brands b on b.id = tm.brand_ref
    where tm.town_ref = id
      and (
        b.owner_id = auth.uid()
        or public.has_team_role(b.id, array['owner','admin','member']::text[])
      )
  )
);

drop policy if exists towns_authenticated_insert on public.towns;
create policy towns_authenticated_insert on public.towns
for insert
with check (auth.uid() is not null);

drop policy if exists town_profiles_member_select on public.town_profiles;
create policy town_profiles_member_select on public.town_profiles
for select
using (public.is_town_member(town_ref));

drop policy if exists town_profiles_member_modify on public.town_profiles;
create policy town_profiles_member_modify on public.town_profiles
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_memberships_owner_all on public.town_memberships;
create policy town_memberships_owner_all on public.town_memberships
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists town_rotations_member_select on public.town_rotations;
create policy town_rotations_member_select on public.town_rotations
for select
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists town_rotations_owner_modify on public.town_rotations;
create policy town_rotations_owner_modify on public.town_rotations
for all
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
)
with check (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists town_pulse_signals_member_select on public.town_pulse_signals;
create policy town_pulse_signals_member_select on public.town_pulse_signals
for select
using (public.is_town_member(town_ref));

drop policy if exists town_pulse_signals_member_insert on public.town_pulse_signals;
create policy town_pulse_signals_member_insert on public.town_pulse_signals
for insert
with check (public.is_town_member(town_ref));

drop policy if exists town_pulse_model_member_select on public.town_pulse_model;
create policy town_pulse_model_member_select on public.town_pulse_model
for select
using (public.is_town_member(town_ref));

drop policy if exists town_pulse_model_member_modify on public.town_pulse_model;
create policy town_pulse_model_member_modify on public.town_pulse_model
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_stories_member_select on public.town_stories;
create policy town_stories_member_select on public.town_stories
for select
using (public.is_town_member(town_ref));

drop policy if exists town_stories_member_insert on public.town_stories;
create policy town_stories_member_insert on public.town_stories
for insert
with check (public.is_town_member(town_ref));

drop policy if exists town_stories_member_modify on public.town_stories;
create policy town_stories_member_modify on public.town_stories
for update
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_stories_member_delete on public.town_stories;
create policy town_stories_member_delete on public.town_stories
for delete
using (public.is_town_member(town_ref));

drop policy if exists town_story_usage_member_select on public.town_story_usage;
create policy town_story_usage_member_select on public.town_story_usage
for select
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists town_story_usage_member_insert on public.town_story_usage;
create policy town_story_usage_member_insert on public.town_story_usage
for insert
with check (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists town_graph_edges_member_select on public.town_graph_edges;
create policy town_graph_edges_member_select on public.town_graph_edges
for select
using (public.is_town_member(town_ref));

drop policy if exists town_graph_edges_member_insert on public.town_graph_edges;
create policy town_graph_edges_member_insert on public.town_graph_edges
for insert
with check (public.is_town_member(town_ref));

drop policy if exists town_graph_edges_member_update on public.town_graph_edges;
create policy town_graph_edges_member_update on public.town_graph_edges
for update
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_graph_suggestions_member_select on public.town_graph_suggestions;
create policy town_graph_suggestions_member_select on public.town_graph_suggestions
for select
using (public.is_town_member(town_ref));

drop policy if exists town_graph_suggestions_member_modify on public.town_graph_suggestions;
create policy town_graph_suggestions_member_modify on public.town_graph_suggestions
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists brand_partners_owner_all on public.brand_partners;
create policy brand_partners_owner_all on public.brand_partners
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists town_micro_routes_member_select on public.town_micro_routes;
create policy town_micro_routes_member_select on public.town_micro_routes
for select
using (public.is_town_member(town_ref));

drop policy if exists town_micro_routes_member_modify on public.town_micro_routes;
create policy town_micro_routes_member_modify on public.town_micro_routes
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_seasons_member_select on public.town_seasons;
create policy town_seasons_member_select on public.town_seasons
for select
using (public.is_town_member(town_ref));

drop policy if exists town_seasons_member_modify on public.town_seasons;
create policy town_seasons_member_modify on public.town_seasons
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_route_season_weights_member_select on public.town_route_season_weights;
create policy town_route_season_weights_member_select on public.town_route_season_weights
for select
using (public.is_town_member(town_ref));

drop policy if exists town_route_season_weights_member_modify on public.town_route_season_weights;
create policy town_route_season_weights_member_modify on public.town_route_season_weights
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists community_sponsors_member_select on public.community_sponsors;
create policy community_sponsors_member_select on public.community_sponsors
for select
using (public.is_town_member(town_ref));

drop policy if exists community_sponsors_member_modify on public.community_sponsors;
create policy community_sponsors_member_modify on public.community_sponsors
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists sponsored_memberships_member_select on public.sponsored_memberships;
create policy sponsored_memberships_member_select on public.sponsored_memberships
for select
using (
  exists (
    select 1
    from public.community_sponsors cs
    where cs.id = sponsor_ref
      and public.is_town_member(cs.town_ref)
  )
);

drop policy if exists sponsored_memberships_member_modify on public.sponsored_memberships;
create policy sponsored_memberships_member_modify on public.sponsored_memberships
for all
using (
  exists (
    select 1
    from public.community_sponsors cs
    where cs.id = sponsor_ref
      and public.is_town_member(cs.town_ref)
  )
)
with check (
  exists (
    select 1
    from public.community_sponsors cs
    where cs.id = sponsor_ref
      and public.is_town_member(cs.town_ref)
  )
);

drop policy if exists town_ambassadors_member_select on public.town_ambassadors;
create policy town_ambassadors_member_select on public.town_ambassadors
for select
using (public.is_town_member(town_ref));

drop policy if exists town_ambassadors_member_modify on public.town_ambassadors;
create policy town_ambassadors_member_modify on public.town_ambassadors
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_invites_member_select on public.town_invites;
create policy town_invites_member_select on public.town_invites
for select
using (public.is_town_member(town_ref));

drop policy if exists town_invites_member_insert on public.town_invites;
create policy town_invites_member_insert on public.town_invites
for insert
with check (
  public.is_town_member(town_ref)
  and public.has_team_role(invited_by_brand_ref, array['owner','admin']::text[])
);

drop policy if exists town_invites_member_modify on public.town_invites;
create policy town_invites_member_modify on public.town_invites
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_success_signals_member_select on public.town_success_signals;
create policy town_success_signals_member_select on public.town_success_signals
for select
using (public.is_town_member(town_ref));

drop policy if exists town_success_signals_member_insert on public.town_success_signals;
create policy town_success_signals_member_insert on public.town_success_signals
for insert
with check (public.is_town_member(town_ref));

drop policy if exists town_success_signals_member_modify on public.town_success_signals;
create policy town_success_signals_member_modify on public.town_success_signals
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists town_board_posts_member_select on public.town_board_posts;
create policy town_board_posts_member_select on public.town_board_posts
for select
using (public.is_town_member(town_ref));

drop policy if exists town_board_posts_public_insert on public.town_board_posts;
create policy town_board_posts_public_insert on public.town_board_posts
for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists town_board_posts_member_modify on public.town_board_posts;
create policy town_board_posts_member_modify on public.town_board_posts
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists community_events_member_select on public.community_events;
create policy community_events_member_select on public.community_events
for select
using (public.is_town_member(town_ref));

drop policy if exists community_events_public_insert on public.community_events;
create policy community_events_public_insert on public.community_events
for insert
to anon, authenticated
with check (true);

drop policy if exists community_events_member_modify on public.community_events;
create policy community_events_member_modify on public.community_events
for all
using (public.is_town_member(town_ref))
with check (public.is_town_member(town_ref));

drop policy if exists event_interest_member_select on public.event_interest;
create policy event_interest_member_select on public.event_interest
for select
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists event_interest_member_modify on public.event_interest;
create policy event_interest_member_modify on public.event_interest
for all
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
)
with check (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists owner_progress_owner_all on public.owner_progress;
create policy owner_progress_owner_all on public.owner_progress
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists owner_win_moments_owner_all on public.owner_win_moments;
create policy owner_win_moments_owner_all on public.owner_win_moments
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists first_win_sessions_member_select on public.first_win_sessions;
create policy first_win_sessions_member_select on public.first_win_sessions
for select
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists first_win_sessions_owner_modify on public.first_win_sessions;
create policy first_win_sessions_owner_modify on public.first_win_sessions
for all
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
)
with check (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

drop policy if exists autopublicity_jobs_member_select on public.autopublicity_jobs;
create policy autopublicity_jobs_member_select on public.autopublicity_jobs
for select
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin','member']::text[])
);

drop policy if exists autopublicity_jobs_owner_modify on public.autopublicity_jobs;
create policy autopublicity_jobs_owner_modify on public.autopublicity_jobs
for all
using (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
)
with check (
  public.is_brand_owner(brand_ref)
  or public.has_team_role(brand_ref, array['owner','admin']::text[])
);

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
