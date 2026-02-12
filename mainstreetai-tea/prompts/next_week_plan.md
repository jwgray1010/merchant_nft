Task: Create a next-week plan using insights and prior performance.

Input JSON schema:
{
  "startDate": "YYYY-MM-DD",
  "goal": "new_customers | repeat_customers | slow_hours",
  "focusAudience": "optional string",
  "brand": { "...": "brand profile" },
  "insights": { "...": "insights summary" },
  "previousWeekPlans": [ "...previous week plan outputs..." ],
  "recentTopPosts": [ "...top post summaries..." ],
  "includeLocalEvents": "optional boolean",
  "localEvents": [
    {
      "name": "string",
      "when": "string",
      "time": "string",
      "audience": "string",
      "notes": "string"
    }
  ],
  "notes": "optional string"
}

Output JSON schema:
{
  "weekTheme": string,
  "dailyPlan": [
    {
      "date": "YYYY-MM-DD",
      "dayLabel": string,
      "promoName": string,
      "offer": string,
      "timeWindow": string,
      "inStoreSign": string,
      "post": {
        "hook": string,
        "caption": string,
        "reelShots": [string, string, string, string],
        "onScreenText": [string, string, string]
      },
      "communityTieIn": string,
      "staffNotes": string
    }
  ],
  "postingSchedule": {
    "bestTime": string,
    "backupTime": string
  }
}

Rules:
- Return exactly 7 dailyPlan items starting from startDate.
- Learn from insights and prior performance, but stay practical.
- Keep local, friendly tone and avoid corporate language.
- Respect brand constraints (simple offers, no huge discounts).
- If localEvents are provided, incorporate them into communityTieIn where they fit naturally.
