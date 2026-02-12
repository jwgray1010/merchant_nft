# MainStreetAI Platform API (Phase 2)

Multi-business (multi-tenant) Express + TypeScript API for local marketing content.

## What it does

- Brand profiles stored as local JSON files (`data/brands/<brandId>.json`)
- Brand CRUD endpoints (`/brands`)
- AI generation endpoints that require `brandId`:
  - `POST /promo?brandId=<brandId>`
  - `POST /social?brandId=<brandId>`
  - `POST /events?brandId=<brandId>`
  - `POST /week-plan?brandId=<brandId>` (7-day content plan)

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

## Brand profile storage

- Seed brand included:
  - `data/brands/main-street-nutrition.json`
- Optional registry index:
  - `data/brands/index.json`

If `index.json` is missing or stale, the app rebuilds it from brand files.

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

### Update brand

```bash
curl -X PUT http://localhost:3001/brands/hometown-bakery \
  -H "Content-Type: application/json" \
  -d '{
    "brandId": "hometown-bakery",
    "businessName": "Hometown Bakery",
    "location": "Independence, KS",
    "type": "restaurant",
    "voice": "Warm, local, and upbeat.",
    "audiences": ["families", "teachers"],
    "productsOrServices": ["Pastries", "Coffee"],
    "hours": "Tue-Sat 6:30am-4:00pm",
    "typicalRushTimes": "7:00am-9:30am",
    "slowHours": "2:00pm-3:30pm",
    "offersWeCanUse": ["Coffee and muffin combo"],
    "constraints": {
      "noHugeDiscounts": true,
      "keepPromosSimple": true,
      "avoidCorporateLanguage": true
    }
  }'
```

### Delete brand

```bash
curl -X DELETE http://localhost:3001/brands/hometown-bakery
```

## AI endpoints (all require brandId)

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

### Week plan (7 days)

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

## Notes

- Request and output validation is done with `zod`.
- Prompt files are in `/prompts`.
- Model responses are parsed as JSON and validated.
- If parsing/validation fails, one automatic repair pass is attempted.
