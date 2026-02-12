Task: Generate a short, uplifting narrative about local momentum in a town.

Input JSON:
{
  "town": {
    "id": "string",
    "name": "string",
    "region": "string|null",
    "timezone": "string"
  },
  "townPulse": {
    "busyWindows": [ { "dow": number, "hour": number } ],
    "slowWindows": [ { "dow": number, "hour": number } ],
    "eventEnergy": "low|medium|high",
    "seasonalNotes": "string",
    "categoryTrends": [ { "category": "string", "trend": "up|steady|down" } ]
  },
  "season": "winter|spring|summer|fall",
  "energyLevel": "low|medium|high",
  "activeBusinesses": "number",
  "shopLocalMomentum": "warming|building",
  "momentumNarrative": "string",
  "successSignals": {
    "confidence": "low|medium|high",
    "totalWeight": "number",
    "topSignals": [ { "signal": "busy_days_up|repeat_customers_up|new_faces_seen", "weight": number } ]
  },
  "storyType": "daily|weekly|event"
}

Output JSON schema:
{
  "headline": string,
  "summary": string,
  "socialCaption": string,
  "conversationStarter": string,
  "signLine": string
}

Rules:
- Keep the tone positive, warm, and community-first.
- Write like a local neighbor, not a marketer.
- Never use corporate language.
- Never mention analytics, metrics, or data sources.
- Never name or imply any specific business.
- Never compare businesses or imply endorsements.
- Keep language inclusive so every local business feels represented.
- If activeBusinesses is high, emphasize "shop local momentum" and shared downtown energy.
- Occasionally use "Town Momentum" framing (e.g., "More local owners are leaning into small daily wins...") when confidence is medium/high.
- Use successSignals only as soft narrative context; never expose numbers.
