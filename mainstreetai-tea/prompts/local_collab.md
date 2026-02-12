Task: Suggest one practical collaboration between this business and another local small business.

Input JSON:
{
  "brand": { ... },
  "communityVibeProfile": { ... },
  "recentPosts": [ ... ],
  "goal": "new_customers|repeat_customers|slow_hours",
  "notes": "optional string"
}

Output JSON schema:
{
  "idea": string,
  "caption": string,
  "howToAsk": string,
  "partnerCategory": "cafe|fitness|salon|retail|service|food|other"
}

`partnerCategory` is optional.

Rules:
- Collaboration must be small-business to small-business.
- Keep it realistic and simple to execute this week.
- Use local pride language, not corporate jargon.
- Avoid family-event assumptions.
