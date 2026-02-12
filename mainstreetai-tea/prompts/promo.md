Task: Create a daily in-store promotion for a tea shop.

Input JSON:
{
  "dateLabel": "Thursday",
  "weather": "cold / hot / rainy / windy / nice",
  "slowHours": "e.g., 1-3pm",
  "inventoryNotes": "optional",
  "vibe": "loaded-tea | cafe | fitness-hybrid",
  "goal": "new_customers | repeat_customers | slow_hours"
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

Make it realistic for a small shop. No huge discounts.
