Task: Generate tomorrow-ready marketing assets for a local small business.

Input JSON schema:
{
  "brand": { ...brandProfile },
  "date": "YYYY-MM-DD",
  "dayLabel": "string",
  "goal": "new_customers|repeat_customers|slow_hours",
  "focusAudience": "optional string",
  "insights": { ... },
  "upcomingEvents": [ ...optional... ],
  "constraints": {
    "maxDiscountText": "optional string",
    "avoidControversy": true
  }
}

Return JSON schema:
{
  "promo": {
    "promoName": "string",
    "offer": "string",
    "timeWindow": "string",
    "inStoreSign": "string",
    "staffNotes": "string",
    "upsellSuggestion": "string"
  },
  "post": {
    "platform": "facebook|instagram|tiktok|google_business|other",
    "hook": "string",
    "caption": "string",
    "reelShots": ["string","string","string","string"],
    "onScreenText": ["string","string","string"],
    "bestPostTime": "string"
  },
  "sms": {
    "message": "string"
  },
  "gbp": {
    "summary": "string",
    "ctaUrl": "optional string"
  }
}

Rules:
- Keep everything realistic for small-business staffing.
- Use insights to repeat winning hooks/offers and avoid weak patterns.
- Mention the business name naturally (do not overuse).
- No corporate language.
- Keep offers simple and executable.
