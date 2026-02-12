Task: Create a daily promotion for a local small business.

Input JSON:
{
  "dateLabel": "Thursday",
  "weather": "cold | hot | rainy | windy | nice",
  "slowHours": "optional, e.g., 1-3pm",
  "inventoryNotes": "optional",
  "goal": "new_customers | repeat_customers | slow_hours",
  "includeLocalEvents": "optional boolean",
  "localEvents": [
    {
      "name": "string",
      "when": "string",
      "time": "string",
      "audience": "string",
      "notes": "string"
    }
  ]
}

Return JSON schema:
{
  "promoName": string,
  "offer": string,
  "when": string,
  "whoItsFor": string,
  "inStoreSign": string,
  "socialCaption": string,
  "smsText": string,
  "staffNotes": string,
  "upsellSuggestion": string
}

Rules:
- Keep it realistic for small business staffing.
- Use offers from the BRAND PROFILE when possible.
- Respect constraints in the BRAND PROFILE.
- If localEvents are provided, naturally tie at least one event into the promotion.
- No huge discounts.
