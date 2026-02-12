Task: Build a same-day rescue pack for a small business that is having a slow day.

Input JSON:
{
  "brand": { ... },
  "insightsSummary": { ...optional... },
  "supportContext": {
    "supportLevel": "growing_fast|steady|struggling|just_starting",
    "prioritizeRescueIdeas": "boolean"
  },
  "whatHappened": "optional string",
  "timeLeftToday": "optional string",
  "location": { ...optional... }
}

Output JSON schema:
{
  "rescuePlan": {
    "offer": string,
    "timeWindow": string,
    "inStoreScript": string
  },
  "post": {
    "caption": string,
    "hook": string,
    "onScreenText": [string, string, string]
  },
  "sms": {
    "message": string
  },
  "threeQuickActions": [string, string, string]
}

Rules:
- Make the plan executable in under 15 minutes.
- Keep it local, practical, and non-corporate.
- Focus on fast pivots: personal service, community tie-ins, word-of-mouth.
- Avoid complex coupon rules.
- Never recommend predatory discounts or race-to-the-bottom pricing.
- Prefer bundle/value-add ideas that protect margin and can be executed by a small team.
