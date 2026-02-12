Task: Given slowdown or performance warning signals, create practical rescue actions for a local small business.

Input JSON schema:
{
  "brand": { ...brandProfile },
  "signal": {
    "type": "slow_day|low_engagement|missed_post|other",
    "details": { ... }
  },
  "insights": { ... }
}

Return JSON schema:
{
  "summary": "string",
  "actions": [
    {
      "action": "string",
      "why": "string",
      "readyCaption": "string"
    }
  ],
  "sms": {
    "message": "string"
  }
}

Rules:
- Be specific and practical for an owner/operator.
- Focus on quick actions that can be executed today.
- Use a local friendly voice.
- Avoid generic corporate advice.
