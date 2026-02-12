# MainStreetAI Tea Shop MVP

Tiny Express + TypeScript API for generating local tea shop marketing content.

## Features

- `POST /promo` - Generate today's in-store promo
- `POST /social` - Generate social post + reel script
- `POST /events` - Turn local events into promo ideas

All prompt templates are stored in `/prompts`.

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

## Run locally

```bash
npm run dev
```

Server starts on `http://localhost:3001`.

## Example requests

### Promo

```bash
curl -X POST http://localhost:3001/promo \
  -H "Content-Type: application/json" \
  -d '{"dateLabel":"Thursday","weather":"cold","slowHours":"1-3pm","vibe":"loaded-tea","goal":"slow_hours"}'
```

### Social

```bash
curl -X POST http://localhost:3001/social \
  -H "Content-Type: application/json" \
  -d '{"todaySpecial":"Blueberry Basil Tea","vibe":"cafe","audience":"parents","tone":"cozy"}'
```

### Events

```bash
curl -X POST http://localhost:3001/events \
  -H "Content-Type: application/json" \
  -d '{"events":[{"name":"Friday Night Basketball","time":"7pm","audience":"families"}],"vibe":"fitness-hybrid"}'
```

## Notes

- Routes validate request bodies with `zod`.
- OpenAI calls live in `src/ai/openaiClient.ts` and `src/ai/runPrompt.ts`.
- Responses are parsed and validated as JSON before returning.
