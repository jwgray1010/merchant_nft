Task: Turn local events into promo ideas.

Input JSON:
{
  "events": [
    { "name": "string", "time": "string", "audience": "string" }
  ],
  "vibe": "loaded-tea | cafe | fitness-hybrid"
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
