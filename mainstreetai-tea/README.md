# MainStreetAI Platform API (Phase 10)

Multi-business (multi-tenant) Express + TypeScript API for local marketing content with memory and learning.

## Features

- Storage adapter mode:
  - `local` (default): local JSON files under `data/local_mode/<userId>/...`
  - `supabase`: hosted Postgres + Supabase Auth + RLS
- Brand CRUD: `/brands`
- Generation endpoints (brand-aware):
  - `POST /promo?brandId=<brandId>`
  - `POST /social?brandId=<brandId>`
  - `POST /events?brandId=<brandId>`
  - `POST /week-plan?brandId=<brandId>`
  - `POST /next-week-plan?brandId=<brandId>`
- Memory and learning:
  - Auto history log for generation endpoints
  - History APIs (`/history`)
  - Posting log (`/posts`)
  - Performance log (`/metrics`)
  - Insights engine (`/insights`, `/insights/refresh`)
- Admin UI:
  - `/admin` home
  - `/admin/brands` manager
  - `/admin/schedule` scheduler
  - `/admin/today` daily checklist
  - generator pages with copy/paste snippets
  - post + metrics logging forms
- Printable in-store signs:
  - `/sign.pdf?brandId=<brandId>&historyId=<historyId>`
- Scheduling + reminders:
  - `/schedule` CRUD
  - `/schedule.ics` calendar export
  - `/today` automated daily task list
- Local event awareness:
  - `/local-events` recurring + one-off community events
  - event-aware generation using `includeLocalEvents`
- Faster onboarding templates:
  - `/brands/from-template`
- Supabase auth + multi-user ownership:
  - bearer token verification middleware
  - route-level auth hardening
  - per-user data isolation
- Supabase migration + RLS policy file:
  - `supabase/schema.sql`
- Integrations (optional via env flags):
  - Buffer publish / scheduling handoff
  - Twilio SMS sends + campaign queue
  - Google Business Profile posting
  - SendGrid email digests
  - Outbox queue + job runner retry/backoff
- SaaS product layer:
  - Stripe subscriptions (starter/pro, trial-ready checkout)
  - Team members by brand (`owner|admin|member`)
  - Plan guards for premium features
  - Public marketing pages (`/`, `/pricing`, `/demo`)
  - Onboarding wizard (`/onboarding`)
  - Demo-mode write protection middleware

All OpenAI calls are centralized in:
- `src/ai/openaiClient.ts`
- `src/ai/runPrompt.ts`

## Requirements

- Node.js 18+
- OpenAI API key

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=3001
STORAGE_MODE=local
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
LOCAL_DEV_USER_ID=local-dev-user
```

Optional integration envs:

```env
INTEGRATION_SECRET_KEY=replace_with_long_random_secret_32plus_chars

ENABLE_BUFFER_INTEGRATION=false
ENABLE_TWILIO_INTEGRATION=false
ENABLE_GBP_INTEGRATION=false
ENABLE_EMAIL_INTEGRATION=false
OUTBOX_RUNNER_ENABLED=true
APP_BASE_URL=http://localhost:3001
CRON_SECRET=replace_with_random_cron_secret
DEMO_MODE=false

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
SMS_CRON_BATCH_SIZE=50

BUFFER_CLIENT_ID=
BUFFER_CLIENT_SECRET=
BUFFER_REDIRECT_URI=http://localhost:3001/api/integrations/buffer/callback
BUFFER_WEBHOOK_SECRET=

SENDGRID_API_KEY=
DIGEST_FROM_EMAIL=
DIGEST_REPLY_TO_EMAIL=
DEFAULT_DIGEST_TO=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/gbp/callback
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/business.manage

FEATURE_AUTOPILOT=true
FEATURE_SMS=true
FEATURE_GBP=true
FEATURE_BILLING=true
FEATURE_TEAMS=true
FEATURE_MARKETING=true
FEATURE_DEMO_MODE=true
```

## Storage modes

- `STORAGE_MODE=local` (default): no Supabase required, local token format is used.
- `STORAGE_MODE=supabase`: requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Auth requirements

All multi-tenant API endpoints require auth:

- `/brands`
- `/promo`, `/social`, `/events`, `/week-plan`, `/next-week-plan`
- `/history`, `/posts`, `/metrics`, `/insights`
- `/schedule`, `/schedule.ics`, `/today`
- `/local-events`
- `/sign.pdf`
- `/integrations`, `/publish`, `/sms`, `/gbp`, `/email`, `/outbox`
- `/autopilot`, `/alerts`
- `/api/billing/create-checkout-session`, `/api/billing/cancel-subscription`
- `/api/team`

### Local mode auth token

Use a bearer token in this format:

```text
Authorization: Bearer local:<userId>|<email>
```

Example:

```bash
export AUTH_TOKEN="local:owner-1|owner@example.com"
```

### Supabase mode auth token

Use an access token from Supabase Auth (email/password sign-in).

For server-rendered admin pages, use:

- `GET /admin/login`
- submit email/password form
- app sets secure `msai_token` cookie for same-origin authenticated requests

## Supabase project setup

1. Create a Supabase project.
2. Open **SQL Editor** and run:
   - `supabase/schema.sql`
3. Confirm RLS is enabled on all app tables.
4. Copy env values into `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Set:
   - `STORAGE_MODE=supabase`

## RLS model (summary)

Every table includes `owner_id` and uses RLS policies that enforce:

```sql
owner_id = auth.uid()
```

This ensures each signed-in user only sees and mutates their own rows.

## Supabase seed script

Seed a demo brand for a specific user id:

```bash
npm run seed:supabase -- --user-id <auth-user-uuid>
```

This seeds/updates:
- `main-street-nutrition`
- business name `Main Street Nutrition`
- location `Independence, KS`

## Run

```bash
npm run dev
```

Server: `http://localhost:3001`

## Data layout (local-first)

```
data/
  brands/    # brand profiles + optional index
  templates/ # starter brand templates by industry
  local_events/ # recurring and one-off community events
  history/   # auto-saved generation outputs per brand
  posts/     # what was actually posted
  metrics/   # manual performance entries
  schedule/  # planned posting reminders
  insights/  # cached insights summaries
```

## Brand endpoints

Use this auth header for API examples:

```bash
AUTH_HEADER="Authorization: Bearer ${AUTH_TOKEN}"
```

### List brands

```bash
curl http://localhost:3001/brands -H "$AUTH_HEADER"
```

### Get one brand

```bash
curl http://localhost:3001/brands/main-street-nutrition -H "$AUTH_HEADER"
```

### Create brand

```bash
curl -X POST http://localhost:3001/brands \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "brandId": "hometown-bakery",
    "businessName": "Hometown Bakery",
    "location": "Independence, KS",
    "type": "restaurant",
    "voice": "Warm, welcoming, and neighborly.",
    "audiences": ["families", "teachers", "downtown workers"],
    "productsOrServices": ["Breakfast pastries", "Coffee", "Custom cakes"],
    "hours": "Tue-Sat 6:30am-4:00pm",
    "typicalRushTimes": "7:00am-9:30am",
    "slowHours": "1:30pm-3:30pm",
    "offersWeCanUse": ["Buy 5 pastries get 1 free", "Coffee and muffin combo"],
    "constraints": {
      "noHugeDiscounts": true,
      "keepPromosSimple": true,
      "avoidCorporateLanguage": true,
      "avoidControversy": true
    }
  }'
```

### Create brand from template

```bash
curl -X POST http://localhost:3001/brands/from-template \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "brandId":"new-day-cafe",
    "businessName":"New Day Cafe",
    "location":"Independence, KS",
    "template":"cafe"
  }'
```

## Generation endpoints (all require brandId)

### Promo

```bash
curl -X POST "http://localhost:3001/promo?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"dateLabel":"Thursday","weather":"cold","goal":"slow_hours","includeLocalEvents":true}'
```

### Social

```bash
curl -X POST "http://localhost:3001/social?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"todaySpecial":"Blue raspberry loaded tea","audience":"parents and teachers","tone":"fun"}'
```

### Events

```bash
curl -X POST "http://localhost:3001/events?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"name":"High School Basketball","time":"7:00pm","audience":"families"}]}'
```

### Week plan

```bash
curl -X POST "http://localhost:3001/week-plan?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate":"2026-02-16",
    "weatherWeek":"Cold early week, warmer by Friday",
    "goal":"repeat_customers",
    "focusAudience":"teachers",
    "includeLocalEvents":true
  }'
```

### Next week plan (learning-aware)

```bash
curl -X POST "http://localhost:3001/next-week-plan?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate":"2026-02-23",
    "goal":"repeat_customers",
    "focusAudience":"teachers",
    "includeLocalEvents":true
  }'
```

## Local events API

### Get local events

```bash
curl "http://localhost:3001/local-events?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

### Add/replace local events

```bash
curl -X POST "http://localhost:3001/local-events?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"append",
    "recurring":[{"name":"Friday Night Basketball","pattern":"Every Fri","audience":"families","notes":"Game crowd"}],
    "oneOff":[{"name":"Spring Festival","date":"2026-04-18","time":"10:00am","audience":"families","notes":"Downtown event"}]
  }'
```

### Delete one local event

```bash
curl -X DELETE "http://localhost:3001/local-events/<eventId>?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

## Logging + insights endpoints

### Log a posted item

```bash
curl -X POST "http://localhost:3001/posts?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"instagram",
    "postedAt":"2026-02-12T19:05:00Z",
    "mediaType":"reel",
    "captionUsed":"After-school pick-me-up is ready!",
    "promoName":"Teacher Pick-Me-Up",
    "notes":"Used quick b-roll from bar top"
  }'
```

### Log performance metrics

```bash
curl -X POST "http://localhost:3001/metrics?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"instagram",
    "postId":"<post-uuid>",
    "window":"24h",
    "views":1820,
    "likes":95,
    "comments":11,
    "shares":8,
    "saves":12,
    "redemptions":9,
    "salesNotes":"Busy after school around 3:30pm"
  }'
```

### Get insights

```bash
curl "http://localhost:3001/insights?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

### Refresh and cache insights

```bash
curl -X POST "http://localhost:3001/insights/refresh?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

## Scheduling + reminders

### Create a schedule item

```bash
curl -X POST "http://localhost:3001/schedule?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"After-school promo reel",
    "platform":"instagram",
    "scheduledFor":"2026-02-13T20:00:00Z",
    "caption":"After-school pick-me-up is ready!",
    "assetNotes":"Use bar-top b-roll + logo outro",
    "status":"planned"
  }'
```

### List schedule items

```bash
curl "http://localhost:3001/schedule?brandId=main-street-nutrition&from=2026-02-12&to=2026-02-20" -H "$AUTH_HEADER"
```

### Update a schedule item

```bash
curl -X PUT "http://localhost:3001/schedule/<scheduleId>?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"status":"posted"}'
```

### Delete a schedule item

```bash
curl -X DELETE "http://localhost:3001/schedule/<scheduleId>?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

### Export .ics calendar reminders

```bash
curl -L "http://localhost:3001/schedule.ics?brandId=main-street-nutrition&from=2026-02-12&to=2026-02-20" -H "$AUTH_HEADER" --output reminders.ics
```

### Get today's automated to-do list

```bash
curl "http://localhost:3001/today?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

### List generation history

```bash
curl "http://localhost:3001/history?brandId=main-street-nutrition&limit=10" -H "$AUTH_HEADER"
```

### Get one history record

```bash
curl "http://localhost:3001/history/<historyId>?brandId=main-street-nutrition" -H "$AUTH_HEADER"
```

### Printable sign PDF (from history)

```bash
curl -L "http://localhost:3001/sign.pdf?brandId=main-street-nutrition&historyId=<historyId>" -H "$AUTH_HEADER" --output sign.pdf
```

## Integrations (Phase 8A) — Buffer-first publishing workflow

### Buffer app setup

1. Create a Buffer app in Buffer developer settings.
2. Set redirect URL in Buffer app to:
   - `<APP_BASE_URL>/api/integrations/buffer/callback`
3. Set env:

```env
ENABLE_BUFFER_INTEGRATION=true
INTEGRATION_SECRET_KEY=replace_with_long_random_secret_32plus_chars
BUFFER_CLIENT_ID=...
BUFFER_CLIENT_SECRET=...
BUFFER_REDIRECT_URI=https://yourapp.vercel.app/api/integrations/buffer/callback
APP_BASE_URL=https://yourapp.vercel.app
CRON_SECRET=replace_with_random_cron_secret
```

### Connect Buffer to a brand (OAuth)

Start OAuth:

```bash
curl -L "http://localhost:3001/api/integrations/buffer/start?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER"
```

Or open in browser while logged into admin:

```text
/api/integrations/buffer/start?brandId=main-street-nutrition
```

After callback, integration is saved in `integrations` table (`provider="buffer"`) with:
- `config`: `buffer_user_id`, `org_id` (if available), `connectedAt`, `profiles[]`
- `secrets_enc`: encrypted token payload

### Publish via API (queue or immediate)

Immediate (queue now + attempt publish):

```bash
curl -X POST "http://localhost:3001/api/publish?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"instagram",
    "caption":"Afternoon pick-me-up is ready!",
    "mediaUrl":"https://example.com/reel-cover.jpg",
    "source":"social"
  }'
```

Scheduled (queued in outbox):

```bash
curl -X POST "http://localhost:3001/api/publish?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"instagram",
    "caption":"Scheduled community promo",
    "scheduledFor":"2026-02-20T21:00:00Z",
    "source":"week-plan"
  }'
```

On queue/sent, records are written to outbox and persisted into posts/history for learning.

### Integration endpoints

- `GET /integrations?brandId=...`
- `GET /api/integrations/buffer/start?brandId=...`
- `GET /api/integrations/buffer/callback`
- `GET /api/integrations/gbp/start?brandId=...`
- `GET /api/integrations/gbp/callback`
- `POST /api/publish?brandId=...`
- `POST /api/jobs/outbox` (cron; requires `x-cron-secret`)
- `GET /api/jobs/digests` (cron; requires `x-cron-secret`)
- `GET /api/autopilot/settings?brandId=...`
- `POST /api/autopilot/settings?brandId=...`
- `POST /api/autopilot/run?brandId=...`
- `GET /api/jobs/autopilot` (cron; requires `x-cron-secret`)
- `GET /api/jobs/alerts` (cron; requires `x-cron-secret`)
- `GET /api/alerts?brandId=...&status=open|all`
- `POST /api/alerts/:id/ack?brandId=...`
- `POST /api/alerts/:id/resolve?brandId=...`
- `POST /api/billing/create-checkout-session`
- `POST /api/billing/cancel-subscription`
- `POST /api/billing/webhook` (Stripe webhook; raw body signature verify)
- `GET /api/billing/status?brandId=...`
- `GET /api/team?brandId=...`
- `POST /api/team/invite?brandId=...`
- `DELETE /api/team/:id?brandId=...`
- `GET /api/sms/contacts?brandId=...`
- `POST /api/sms/contacts?brandId=...`
- `PUT /api/sms/contacts/:contactId?brandId=...`
- `DELETE /api/sms/contacts/:contactId?brandId=...`
- `POST /api/sms/send?brandId=...`
- `POST /api/sms/campaign?brandId=...`
- `GET /api/sms/log?brandId=...`
- `GET /api/email/subscriptions?brandId=...`
- `POST /api/email/subscriptions?brandId=...`
- `PUT /api/email/subscriptions/:id?brandId=...`
- `DELETE /api/email/subscriptions/:id?brandId=...`
- `POST /api/email/digest/preview?brandId=...`
- `POST /api/email/digest/send?brandId=...`
- `GET /api/email/log?brandId=...`
- `POST /api/gbp/post?brandId=...`
- `POST /publish?brandId=...`
- `POST /sms/send?brandId=...`
- `POST /sms/campaign?brandId=...`
- `POST /gbp/post?brandId=...` (legacy alias)
- `POST /email/digest/preview?brandId=...`
- `POST /email/digest/send?brandId=...`
- `GET /outbox?brandId=...`
- `POST /outbox/:id/retry?brandId=...`

### Provider setup checklist

- Buffer:
  - enable `ENABLE_BUFFER_INTEGRATION=true`
  - connect per brand with `GET /api/integrations/buffer/start?brandId=...`
- Twilio:
  - enable `ENABLE_TWILIO_INTEGRATION=true`
  - set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
  - optional batch size for campaigns: `SMS_CRON_BATCH_SIZE` (default 50)
- Google Business Profile:
  - enable `ENABLE_GBP_INTEGRATION=true`
  - set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  - optional scopes var: `GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/business.manage`
  - connect per brand with `GET /api/integrations/gbp/start?brandId=...`
- Email digest (SendGrid):
  - enable `ENABLE_EMAIL_INTEGRATION=true`
  - set `SENDGRID_API_KEY`, `DIGEST_FROM_EMAIL`
  - optional: `DIGEST_REPLY_TO_EMAIL`, `DEFAULT_DIGEST_TO`

### Outbox runner / scheduling

- Local dev:
  - job runner starts automatically and checks queue every ~30s.
  - controlled by `OUTBOX_RUNNER_ENABLED=true|false`
- Production:
  - keep the Node process running with runner enabled **or**
  - trigger queue processing from external cron / scheduled function.
  - Supabase Scheduled Functions or host-level cron are both valid patterns.

Vercel Cron example target:

- `POST https://yourapp.vercel.app/api/jobs/outbox` (every 5 minutes)
- header: `x-cron-secret: <CRON_SECRET>`
- `GET https://yourapp.vercel.app/api/jobs/digests` (every hour)
- header: `x-cron-secret: <CRON_SECRET>`
- `GET https://yourapp.vercel.app/api/jobs/autopilot` (hourly at minute 5)
- header: `x-cron-secret: <CRON_SECRET>`
- `GET https://yourapp.vercel.app/api/jobs/alerts` (hourly at minute 10, optional)
- header: `x-cron-secret: <CRON_SECRET>`

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/jobs/outbox", "schedule": "*/5 * * * *" },
    { "path": "/api/jobs/digests", "schedule": "0 * * * *" },
    { "path": "/api/jobs/autopilot", "schedule": "5 * * * *" },
    { "path": "/api/jobs/alerts", "schedule": "10 * * * *" }
  ]
}
```

### Autopilot Growth Engine (Phase 9)

Autopilot generates a **tomorrow-ready pack** per brand (promo + social caption + sign copy + SMS + GBP summary), learns from performance, and queues publishing/notifications through outbox.

Key APIs:

- `GET /api/autopilot/settings?brandId=...`
- `POST /api/autopilot/settings?brandId=...`
- `POST /api/autopilot/run?brandId=...`
- `GET /api/alerts?brandId=...&status=open|all`
- `POST /api/alerts/:id/ack?brandId=...`
- `POST /api/alerts/:id/resolve?brandId=...`
- `GET /api/jobs/autopilot` (cron, protected by `x-cron-secret`)
- `GET /api/jobs/alerts` (cron, protected by `x-cron-secret`)

Autopilot safety guard:

- max **1 autopilot run per brand within 20 hours** (checked via history endpoint `autopilot_run`).

Enable/configure from Admin:

- `/admin/autopilot` (settings + run now)
- `/admin/tomorrow` (latest copy-ready tomorrow pack)
- `/admin/alerts` (open alerts + acknowledge/resolve)

Sample settings upsert:

```bash
curl -X POST "http://localhost:3001/api/autopilot/settings?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "cadence": "daily",
    "hour": 7,
    "timezone": "America/Chicago",
    "goals": ["repeat_customers","slow_hours"],
    "channels": ["facebook","instagram","google_business"],
    "notifyEmail": "owner@example.com",
    "notifySms": "+15555550123"
  }'
```

Manual run:

```bash
curl -X POST "http://localhost:3001/api/autopilot/run?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"goal":"repeat_customers"}'
```

### Stripe setup (SaaS billing)

1. Create Stripe products/prices for Starter and Pro.
2. Set env vars:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_PRICE_STARTER`
   - `STRIPE_PRICE_PRO`
3. Configure Stripe webhook endpoint:
   - `<APP_BASE_URL>/api/billing/webhook`
4. Subscribe by calling:
   - `POST /api/billing/create-checkout-session`

Checkout request:

```bash
curl -X POST "http://localhost:3001/api/billing/create-checkout-session" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"brandId":"main-street-nutrition","priceId":"'"$STRIPE_PRICE_PRO"'"}'
```

### Team access (owner/admin/member)

- Owner:
  - billing management
  - team management
  - full admin actions
- Admin:
  - autopilot/settings + operational actions
- Member:
  - content generation + scheduling workflows

Team APIs:

```bash
curl "http://localhost:3001/api/team?brandId=main-street-nutrition" -H "$AUTH_HEADER"

curl -X POST "http://localhost:3001/api/team/invite?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"email":"staff@example.com","role":"member"}'
```

Admin pages:

- `/admin/billing`
- `/admin/team`
- `/admin/welcome`

### Onboarding flow

New users can open:

- `/onboarding`

Wizard flow:

1. business basics
2. voice + audience + offers
3. integrations (optional)
4. autopilot toggle

On completion, MainStreetAI creates/updates a brand from template and redirects to:

- `/admin/tomorrow?brandId=...`

### Public marketing + demo mode

Public pages:

- `/` (marketing hero)
- `/pricing`
- `/demo`

Demo safety:

- set `DEMO_MODE=true` or pass `?demo=true`
- write routes for publish/SMS/GBP/billing are blocked in demo mode

### SMS examples (Twilio)

Create or upsert a contact:

```bash
curl -X POST "http://localhost:3001/api/sms/contacts?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "phone":"+15555550123",
    "name":"Ms. Smith",
    "tags":["teachers","vip"],
    "optedIn":true,
    "consentSource":"in_store"
  }'
```

List contacts:

```bash
curl "http://localhost:3001/api/sms/contacts?brandId=main-street-nutrition&limit=100" \
  -H "$AUTH_HEADER"
```

Send one-off SMS (queued):

```bash
curl -X POST "http://localhost:3001/api/sms/send?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15555550123","message":"Teachers get a free flavor add-on today!","purpose":"promo"}'
```

Campaign by list tag:

```bash
curl -X POST "http://localhost:3001/api/sms/campaign?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"listTag":"teachers","message":"After-school combo starts at 3pm!"}'
```

Campaign dry run:

```bash
curl -X POST "http://localhost:3001/api/sms/campaign?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"listTag":"teachers","message":"After-school combo starts at 3pm!","dryRun":true}'
```

View SMS logs:

```bash
curl "http://localhost:3001/api/sms/log?brandId=main-street-nutrition&limit=100" \
  -H "$AUTH_HEADER"
```

### Google Business examples

Start OAuth:

```bash
curl -L "http://localhost:3001/api/integrations/gbp/start?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER"
```

Queue GBP post:

```bash
curl -X POST "http://localhost:3001/api/gbp/post?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "summary":"Fresh daily specials are ready!",
    "callToActionUrl":"https://example.com",
    "mediaUrl":"https://example.com/promo.jpg",
    "scheduledFor":"2026-02-20T21:00:00Z"
  }'
```

Posts are always queued to outbox (`type="gbp_post"`) and published by cron.

### Google Business Profile setup

1. Create a Google Cloud project.
2. Enable Business Profile APIs for your project.
3. Configure OAuth consent screen.
4. Add redirect URI:
   - `<APP_BASE_URL>/api/integrations/gbp/callback`
5. Set env vars in Vercel:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - `GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/business.manage`
   - `APP_BASE_URL`

Cron workflow:

- GBP posts are queued into outbox.
- Vercel Cron calls `/api/jobs/outbox` every 5 minutes.
- Outbox publishes due GBP posts automatically.

### Email digest examples

Create subscription:

```bash
curl -X POST "http://localhost:3001/api/email/subscriptions?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"toEmail":"owner@example.com","cadence":"weekly","dayOfWeek":1,"hour":9,"enabled":true}'
```

Preview:

```bash
curl -X POST "http://localhost:3001/api/email/digest/preview?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"rangeDays":14,"includeNextWeekPlan":true}'
```

Queue/send (explicit recipient):

```bash
curl -X POST "http://localhost:3001/api/email/digest/send?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"toEmail":"owner@example.com","rangeDays":14}'
```

Queue/send (subscription defaults):

```bash
curl -X POST "http://localhost:3001/api/email/digest/send?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{}'
```

View email log:

```bash
curl "http://localhost:3001/api/email/log?brandId=main-street-nutrition&limit=100" \
  -H "$AUTH_HEADER"
```

## Admin UI (no frontend framework)

Open:

```bash
http://localhost:3001/admin/login
```

From admin you can:
- pick a business
- generate promo/social/events/week-plan/next-week-plan
- copy caption/hook/SMS/sign text quickly
- log posted content and metrics via forms
- print sign PDFs
- manage schedule items and export calendar reminders
- view today's checklist
- manage recurring and one-off local events
- onboard new brands quickly from templates
- connect Buffer/Twilio/GBP/Email integrations
- configure and run Autopilot
- monitor/respond to anomaly alerts
- view tomorrow-ready copy packs
- manage opt-in SMS contacts, send one-offs, and run campaigns
- send GBP posts
- preview and queue email digests
- monitor and retry outbox jobs

## Phase 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 Workflow

1. Generate promo/social/week-plan content.
2. Log what actually got posted using `POST /posts`.
3. Log performance later with `POST /metrics` (24h/48h/7d).
4. Review recommendations via `GET /insights`.
5. Generate an improved weekly plan using `POST /next-week-plan`.
6. Use `/admin` for day-to-day owner operations without Postman/curl.
7. Plan upcoming posts in `/admin/schedule` and export reminders via `.ics`.
8. Check `/admin/today` each morning for a practical to-do list.
9. Keep `/admin/local-events` updated so promos and plans stay community-aware.
10. Connect integrations in `/admin/integrations`.
11. Publish through Buffer with `/publish` or `/admin/integrations/buffer`.
12. Send opt-in SMS via `/admin/sms`.
13. Post to Google Business from `/admin/gbp`.
14. Manage digest subscriptions in `/admin/email`, queue/send digests, and monitor `/admin/outbox`.
15. Enable Autopilot in `/admin/autopilot` for daily tomorrow-ready generation.
16. Use `/admin/tomorrow` for quick copy/paste execution each day.
17. Review `/admin/alerts` and apply rescue actions when anomalies are detected.
18. Manage subscription/plan in `/admin/billing`.
19. Invite collaborators in `/admin/team`.
20. Send new users through `/onboarding` and `/admin/welcome`.

## Deployment checklist (Vercel)

- Verify these cron jobs exist:
  - `/api/jobs/outbox` (`*/5 * * * *`)
  - `/api/jobs/digests` (`0 * * * *`)
  - `/api/jobs/autopilot` (`5 * * * *`)
  - `/api/jobs/alerts` (`10 * * * *`, optional but recommended)
- Set Stripe webhook endpoint:
  - `<APP_BASE_URL>/api/billing/webhook`
- Keep secrets server-only:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `INTEGRATION_SECRET_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

## Notes

- History is auto-saved after successful generation requests.
- Request and output validation uses `zod`.
- Insights are resilient when metrics are sparse (limited-data behavior).
- Model responses are parsed as JSON and validated, with one repair retry if needed.
- In `supabase` mode, verify your JWT subject matches table `owner_id` values.
- If every query returns empty in Supabase mode, re-check RLS policies and bearer token validity.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `INTEGRATION_SECRET_KEY` to browser code.
- Only send SMS to explicit opt-in recipients.
- Use sensible frequency caps and avoid spam behavior for SMS/email campaigns.
