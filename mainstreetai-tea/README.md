# MainStreetAI Platform API (Phase 4)

Multi-business (multi-tenant) Express + TypeScript API for local marketing content with memory and learning.

## Features

- Brand profiles (local JSON): `data/brands/<brandId>.json`
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
  - generator pages with copy/paste snippets
  - post + metrics logging forms
- Printable in-store signs:
  - `/sign.pdf?brandId=<brandId>&historyId=<historyId>`

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
```

## Run

```bash
npm run dev
```

Server: `http://localhost:3001`

## Data layout (local-first)

```
data/
  brands/    # brand profiles + optional index
  history/   # auto-saved generation outputs per brand
  posts/     # what was actually posted
  metrics/   # manual performance entries
  insights/  # cached insights summaries
```

## Brand endpoints

### List brands

```bash
curl http://localhost:3001/brands
```

### Get one brand

```bash
curl http://localhost:3001/brands/main-street-nutrition
```

### Create brand

```bash
curl -X POST http://localhost:3001/brands \
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

## Generation endpoints (all require brandId)

### Promo

```bash
curl -X POST "http://localhost:3001/promo?brandId=main-street-nutrition" \
  -H "Content-Type: application/json" \
  -d '{"dateLabel":"Thursday","weather":"cold","goal":"slow_hours"}'
```

### Social

```bash
curl -X POST "http://localhost:3001/social?brandId=main-street-nutrition" \
  -H "Content-Type: application/json" \
  -d '{"todaySpecial":"Blue raspberry loaded tea","audience":"parents and teachers","tone":"fun"}'
```

### Events

```bash
curl -X POST "http://localhost:3001/events?brandId=main-street-nutrition" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"name":"High School Basketball","time":"7:00pm","audience":"families"}]}'
```

### Week plan

```bash
curl -X POST "http://localhost:3001/week-plan?brandId=main-street-nutrition" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate":"2026-02-16",
    "weatherWeek":"Cold early week, warmer by Friday",
    "goal":"repeat_customers",
    "focusAudience":"teachers"
  }'
```

### Next week plan (learning-aware)

```bash
curl -X POST "http://localhost:3001/next-week-plan?brandId=main-street-nutrition" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate":"2026-02-23",
    "goal":"repeat_customers",
    "focusAudience":"teachers"
  }'
```

## Logging + insights endpoints

### Log a posted item

```bash
curl -X POST "http://localhost:3001/posts?brandId=main-street-nutrition" \
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
curl "http://localhost:3001/insights?brandId=main-street-nutrition"
```

### Refresh and cache insights

```bash
curl -X POST "http://localhost:3001/insights/refresh?brandId=main-street-nutrition"
```

### List generation history

```bash
curl "http://localhost:3001/history?brandId=main-street-nutrition&limit=10"
```

### Get one history record

```bash
curl "http://localhost:3001/history/<historyId>?brandId=main-street-nutrition"
```

### Printable sign PDF (from history)

```bash
curl -L "http://localhost:3001/sign.pdf?brandId=main-street-nutrition&historyId=<historyId>" --output sign.pdf
```

## Admin UI (no frontend framework)

Open:

```bash
http://localhost:3001/admin
```

From admin you can:
- pick a business
- generate promo/social/events/week-plan/next-week-plan
- copy caption/hook/SMS/sign text quickly
- log posted content and metrics via forms
- print sign PDFs

## Phase 3 + 4 Workflow

1. Generate promo/social/week-plan content.
2. Log what actually got posted using `POST /posts`.
3. Log performance later with `POST /metrics` (24h/48h/7d).
4. Review recommendations via `GET /insights`.
5. Generate an improved weekly plan using `POST /next-week-plan`.
6. Use `/admin` for day-to-day owner operations without Postman/curl.

## Notes

- History is auto-saved after successful generation requests.
- Request and output validation uses `zod`.
- Insights are resilient when metrics are sparse (limited-data behavior).
- Model responses are parsed as JSON and validated, with one repair retry if needed.
