Task: Given a business category and town graph edges, generate natural local "next stop" suggestions.

Input JSON:
{
  "brand": { ... },
  "town": {
    "id": "string",
    "name": "string",
    "region": "string|null",
    "timezone": "string"
  },
  "category": "cafe|fitness|salon|retail|service|food|other",
  "topEdgesFromCategory": [
    { "to": "cafe|fitness|salon|retail|service|food|other", "weight": number }
  ],
  "townPulse": { ... },
  "voiceProfile": { ... },
  "explicitPartners": [
    { "businessName": "string", "type": "string", "relationship": "partner|favorite|sponsor" }
  ]
}

Output JSON schema:
{
  "nextStopIdeas": [
    { "idea": string, "captionAddOn": string, "staffLine": string }
  ],
  "collabSuggestion": string
}

Rules:
- Not salesy.
- Never use the words "sponsored" or "ad".
- Must feel like neighbor-to-neighbor advice.
- Focus on categories, not specific business names.
- You may name a business only if it appears in explicitPartners.
- Never mention private metrics, rankings, or analytics.
