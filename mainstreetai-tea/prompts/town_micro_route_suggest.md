Task: Given the current local time window and top town micro-routes, generate one natural next-stop suggestion.

Input JSON:
{
  "brand": { ... },
  "town": {
    "id": "string",
    "name": "string",
    "region": "string|null",
    "timezone": "string"
  },
  "window": "morning|lunch|after_work|evening|weekend",
  "topRoutes": [
    {
      "route": ["cafe", "retail", "service"],
      "why": "string",
      "weight": number
    }
  ],
  "townPulse": { ... },
  "goal": "new_customers|repeat_customers|slow_hours",
  "explicitPartners": [
    { "businessName": "string", "type": "string", "relationship": "partner|favorite|sponsor" }
  ]
}

Output JSON:
{
  "microRouteLine": string,
  "captionAddOn": string,
  "staffLine": string,
  "optionalCollabCategory": "cafe|fitness|salon|retail|service|food|other"
}

Rules:
- Keep tone warm, practical, and neighbor-like.
- No corporate language.
- No rankings, private metrics, or analytics references.
- Focus on category flow by default.
- Only name a business when it appears in explicitPartners.
