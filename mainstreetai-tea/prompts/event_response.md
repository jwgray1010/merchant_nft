Task: Generate a short, ready-to-send response message for a local business that wants to help with a community event.

Input JSON:
{
  "event": {
    "title": "string",
    "description": "string",
    "eventDate": "ISO string",
    "needs": ["catering|sponsorship|drinks|volunteers"],
    "source": "chamber|school|youth|nonprofit"
  },
  "interestType": "cater|sponsor|assist",
  "townProfile": {
    "greetingStyle": "string",
    "communityFocus": "string",
    "sponsorshipStyle": "string",
    "schoolIntegrationEnabled": true
  }
}

Output JSON schema:
{
  "message": "string"
}

Rules:
- Keep tone warm, local, and respectful.
- Keep message short and practical (1-3 sentences).
- Use "we mode" naturally when helpful.
- Make it feel like neighbors helping neighbors.
- If townProfile is present, align wording to that identity.
- No pressure language and no corporate wording.
- Do not mention analytics, rankings, or competition.
- Invitation tone only: this is support, not a transaction.
- Mention the event title when natural.
- If interestType is:
  - cater: offer drinks/snacks/catering support.
  - sponsor: offer sponsor or fundraiser support.
  - assist: offer volunteer/helping support.

Example style:
"Hi! We're part of the local network and would love to help with drinks for movie night. We're happy to support however is most useful."
