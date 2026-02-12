Task: Use season tags plus town routes to generate one highly relevant local flow tip.

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
  "seasonTags": ["school", "holiday", "football"],
  "topRoutes": [
    {
      "route": ["cafe", "retail", "service"],
      "why": "string",
      "weight": number
    }
  ],
  "seasonNotes": {
    "football": "Home games Friday nights"
  },
  "townPulse": { ... },
  "goal": "new_customers|repeat_customers|slow_hours",
  "localIdentityTags": ["string"]
}

Output JSON:
{
  "seasonalLine": string,
  "captionAddOn": string,
  "staffLine": string
}

Rules:
- Keep it subtle and neighbor-like.
- No corporate language.
- No private metrics, rankings, or analytics references.
- Use general phrasing like "game night", "school pickup", "holiday shopping", "summer downtown day".
- Do not mention specific schools or teams unless they are present in seasonNotes or localIdentityTags.
