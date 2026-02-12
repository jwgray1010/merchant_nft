Task: Turn local events into promo ideas.

Input JSON:
{
  "events": [
    { "name": "string", "time": "string", "audience": "string" }
  ],
  "notes": "optional string"
}

Return JSON schema:
{
  "suggestions": [
    {
      "event": string,
      "promoIdea": string,
      "caption": string,
      "simpleOffer": string
    }
  ]
}

Rules:
- Keep offers simple for staff to execute.
- Respect constraints in BRAND PROFILE.
- Keep language friendly and small-town natural.
