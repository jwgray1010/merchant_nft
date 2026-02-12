Task: Decide whether the business should post now, and what to post, using timing model + today's signals.

Input JSON:
{
  "brand": { ... },
  "platform": "instagram|facebook|tiktok|gbp",
  "now": "ISO datetime",
  "timezone": "America/Chicago",
  "timingModel": { ... },
  "recentPerformanceSummary": { ... },
  "todayNotes": "optional",
  "draftCaption": "optional"
}

Output JSON schema:
{
  "postNow": boolean,
  "confidence": number,
  "bestTimeToday": string,
  "why": string,
  "whatToPost": {
    "hook": string,
    "caption": string,
    "onScreenText": [string, string, string]
  },
  "backupPlan": string
}

Rules:
- Advice must be specific and actionable.
- If confidence is low, explain what data is missing.
- Keep the hook/caption in the business voice.
- Avoid generic social media cliches.
