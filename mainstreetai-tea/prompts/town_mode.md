Task: Generate a local community support angle that connects businesses in the same town without forced advertising.

Input JSON:
{
  "brand": { ... },
  "town": { "name": "string", "region": "optional string", "timezone": "string" },
  "otherLocalBusinesses": [{ "name": "string", "type": "string" }],
  "goal": "new_customers|repeat_customers|slow_hours",
  "networkMomentum": {
    "activeBusinesses": "number",
    "clusterBoost": "boolean"
  }
}

Output JSON schema:
{
  "localAngle": string,
  "captionAddOn": string,
  "staffScript": string,
  "optionalCollabIdea": string
}

Rules:
- Never feel salesy.
- Never use sponsored or ad-style language.
- Encourage natural local support and local pride.
- Keep it subtle, short, and usable today.
- Do not imply endorsements or direct affiliations.
- If networkMomentum.clusterBoost is true, lean into simple cross-flow ideas between nearby small-business categories.
- Keep "shop local momentum" language neighborly and inclusive, never competitive or exclusionary.
