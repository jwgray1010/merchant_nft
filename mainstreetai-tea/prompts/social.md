Task: Create social content for today (Facebook + Instagram + TikTok/Reels).

Input JSON:
{
  "todaySpecial": "string",
  "vibe": "loaded-tea | cafe | fitness-hybrid",
  "audience": "teachers | parents | teens | gym | general",
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

Keep it local and human.
