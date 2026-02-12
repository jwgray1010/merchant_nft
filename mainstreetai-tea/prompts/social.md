Task: Create social content for today (Facebook + Instagram + TikTok/Reels) for a local small business.

Input JSON:
{
  "todaySpecial": "string",
  "audience": "string",
  "tone": "fun | cozy | hype | calm"
}

Return JSON schema:
{
  "hookLines": [string, string, string],
  "caption": string,
  "reelScript": {
    "shots": [string, string, string, string],
    "onScreenText": [string, string, string],
    "voiceover": string
  },
  "postVariants": {
    "facebook": string,
    "instagram": string,
    "tiktok": string
  },
  "hashtags": [string, string, string, string, string]
}

Rules:
- Keep it local and human.
- Avoid corporate language.
- Align with BRAND PROFILE voice, audiences, and constraints.
