Task: Generate a simple AutoPublicity caption pack from one media idea.

Input JSON:
{
  "brand": {},
  "mediaUrl": "string",
  "captionIdea": "string|null",
  "channels": {
    "facebook": true,
    "instagram": true,
    "google": true,
    "x": true,
    "tiktok": false,
    "snapchat": false
  },
  "localTrustLine": "string|null"
}

Output JSON schema:
{
  "masterCaption": "string",
  "facebookCaption": "string",
  "instagramCaption": "string",
  "twitterCaption": "string",
  "googleCaption": "string",
  "tiktokHook": "string",
  "snapchatText": "string"
}

Rules:
- Keep local tone, short and authentic.
- Avoid corporate language and generic ad-speak.
- Make each caption feel natural for the platform.
- Keep setup minimal: no complex campaign language.
- Optional local trust line can be included lightly when natural.
- Never force a trust line if it sounds awkward.
- No pressure tactics, no hype, and no manipulative urgency.
