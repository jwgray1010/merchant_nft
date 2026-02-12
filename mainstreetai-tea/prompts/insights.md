Task: Analyze recent content + metrics for a small business and produce practical insights.

Input JSON schema:
{
  "brand": { "...": "brandProfile" },
  "history": [ "...recent generations..." ],
  "posts": [ "...recent posts..." ],
  "metrics": [ "...recent metrics..." ],
  "aggregates": {
    "dataCoverage": {
      "historyCount": "number",
      "postsCount": "number",
      "metricsCount": "number",
      "note": "string"
    },
    "platformAverages": [ "...optional summaries..." ],
    "commonOfferWords": [ "...optional words..." ],
    "frequentPostingHours": [ "...optional hours..." ]
  }
}

Output JSON schema:
{
  "summary": string,
  "topHooks": [string, string, string],
  "topOffers": [string, string, string],
  "bestPlatforms": [string, string],
  "bestPostingTimes": [string, string],
  "whatToRepeat": [string, string, string],
  "whatToAvoid": [string, string, string],
  "next7DaysFocus": string
}

Rules:
- Local, non-corporate voice.
- Be specific and practical for a busy small business owner.
- If metrics are missing, infer cautiously and explicitly say "based on limited data".
- Keep recommendations realistic for staffing and daily operations.
