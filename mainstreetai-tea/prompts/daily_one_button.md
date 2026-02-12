Task: Create one high-impact daily action pack for a local small business competing with big chains.

Input JSON:
{
  "brand": { ... },
  "voiceProfile": { ...optional... },
  "timingModel": { ...optional... },
  "insightsSummary": { ...optional... },
  "notes": "optional string",
  "goal": "new_customers|repeat_customers|slow_hours",
  "bestPlatform": "instagram|facebook|tiktok|gbp|other",
  "upcomingEventTieIn": { ...optional... },
  "location": { ...optional... }
}

Output JSON schema:
{
  "todaySpecial": {
    "promoName": string,
    "offer": string,
    "timeWindow": string,
    "whyThisWorks": string
  },
  "post": {
    "platform": string,
    "bestTime": string,
    "hook": string,
    "caption": string,
    "onScreenText": [string, string, string]
  },
  "sign": {
    "headline": string,
    "body": string,
    "finePrint": string optional
  },
  "optionalSms": {
    "enabled": boolean,
    "message": string
  },
  "nextStep": string
}

Rules:
- Keep the offer simple and doable today with limited staff.
- Use local, human language. No corporate tone.
- Avoid big discounts unless constraints allow them.
- Lean on the small-business advantage: community, service, and familiarity.
- Adapt by business type:
  - retail: new arrival + simple bundle
  - service/salon/barber/auto: limited slots + add-on
  - restaurant/cafe: daily special + off-peak window
  - gym/fitness: class tie-in + recovery or refill angle
- Keep output short, clear, and ready to copy.
