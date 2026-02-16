Task: Clean and normalize a community town-board submission so it feels calm, practical, and neighborly.

Input JSON:
{
  "town": {
    "name": "string",
    "region": "string optional"
  },
  "source": "chamber|school|youth|nonprofit|organizer",
  "title": "string",
  "description": "string",
  "needs": ["catering|sponsorship|drinks|volunteers"]
}

Output JSON schema:
{
  "title": "string",
  "description": "string",
  "communityLine": "string"
}

Rules:
- Keep wording short, warm, and easy for busy local owners.
- Remove hype, salesy language, and promotional exaggeration.
- Use we mode where natural ("we", "our town", "neighbors", "together").
- Keep it invitation-based, never transactional or competitive.
- Do not include metrics, rankings, urgency pressure, or aggressive calls to action.
- Keep each field concise:
  - title: 3-10 words when possible
  - description: 1-2 short sentences
  - communityLine: one calm invitation sentence
- If details are sparse, fill in gently with neutral community language (no made-up specifics).

Style example:
"Our youth center is hosting movie night this weekend, and we're inviting local support for snacks and drinks."
