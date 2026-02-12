# MainStreetAI Platform API (Phase 8)

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

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

SENDGRID_API_KEY=
DIGEST_FROM_EMAIL=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/integrations/gbp/callback
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

## Integrations (Phase 8)

### Start with Buffer only (quickstart)

1. Set env:

```env
ENABLE_BUFFER_INTEGRATION=true
INTEGRATION_SECRET_KEY=replace_with_long_random_secret_32plus_chars
```

2. Connect Buffer for a brand:

```bash
curl -X POST "http://localhost:3001/integrations/buffer/connect?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken":"<buffer-access-token>",
    "defaultChannelId":"<buffer-channel-id>"
  }'
```

3. Publish now:

```bash
curl -X POST "http://localhost:3001/publish?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"instagram",
    "caption":"Afternoon pick-me-up is ready!",
    "mediaUrl":"https://example.com/reel-cover.jpg"
  }'
```

4. Publish using a scheduled item:

```bash
curl -X POST "http://localhost:3001/publish?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"instagram",
    "caption":"Scheduled post from planner",
    "scheduleId":"<schedule-id>"
  }'
```

If schedule time is in the future, it is queued in outbox.

### Integration endpoints

- `GET /integrations?brandId=...`
- `POST /integrations/buffer/connect?brandId=...`
- `POST /integrations/gbp/connect?brandId=...`
- `GET /integrations/gbp/callback`
- `POST /publish?brandId=...`
- `POST /sms/send?brandId=...`
- `POST /sms/campaign?brandId=...`
- `POST /gbp/post?brandId=...`
- `POST /email/digest/preview?brandId=...`
- `POST /email/digest/send?brandId=...`
- `GET /outbox?brandId=...`
- `POST /outbox/:id/retry?brandId=...`

### SMS examples (Twilio)

```bash
curl -X POST "http://localhost:3001/sms/send?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15555550123","message":"Teachers get a free flavor add-on today!"}'
```

```bash
curl -X POST "http://localhost:3001/sms/campaign?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"listName":"teachers","recipients":["+15555550123","+15555550124"],"message":"After-school combo starts at 3pm!"}'
```

### Google Business examples

Start OAuth:

```bash
curl -X POST "http://localhost:3001/integrations/gbp/connect?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"locationName":"accounts/<account-id>/locations/<location-id>"}'
```

Create GBP post:

```bash
curl -X POST "http://localhost:3001/gbp/post?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Fresh daily specials are ready!","cta":"LEARN_MORE","url":"https://example.com"}'
```

### Email digest examples

Preview:

```bash
curl -X POST "http://localhost:3001/email/digest/preview?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER"
```

Queue/send:

```bash
curl -X POST "http://localhost:3001/email/digest/send?brandId=main-street-nutrition" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"to":"owner@example.com","cadence":"weekly"}'
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
- send SMS campaigns and GBP posts
- preview and queue email digests
- monitor and retry outbox jobs

## Phase 3 + 4 + 5 + 6 + 7 + 8 Workflow

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
14. Queue digest emails and monitor `/admin/outbox`.

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
