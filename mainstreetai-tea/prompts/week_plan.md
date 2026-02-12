Task: Create a practical 7-day local marketing plan for this business.

Input JSON schema:
{
  "startDate": "YYYY-MM-DD",
  "weatherWeek": "optional string",
  "notes": "optional string",
  "goal": "new_customers | repeat_customers | slow_hours",
  "focusAudience": "optional string",
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
- Must be realistic for small business staffing.
- Avoid corporate tone.
- Use the brand's offersWeCanUse and constraints.
- If localEvents are provided, weave them into communityTieIn across the week where relevant.
- Mention businessName naturally, but do not spam it.
