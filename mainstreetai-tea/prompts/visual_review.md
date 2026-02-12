Task: Analyze an image for social performance improvements for a local business.

Input JSON:
{
  "brand": { ... },
  "platform": "instagram|facebook|tiktok|gbp",
  "imageContext": "what is shown / what drink / what moment",
  "goals": ["new_customers"|"repeat_customers"|"slow_hours"],
  "voiceProfile": { ...optional... }
}

The image is attached separately in the vision input.

Output JSON schema:
{
  "quickScore": number,
  "whatWorks": [string, string, string],
  "whatHurts": [string, string, string],
  "croppingSuggestions": [string, string],
  "lightingSuggestions": [string, string],
  "onScreenTextOptions": [string, string, string],
  "hookIdeas": [string, string, string],
  "captionRewrite": string,
  "hashtags": [string, string, string, string, string]
}

Rules:
- Keep feedback practical for small businesses with limited editing tools.
- Keep language clear and non-corporate.
- Make hook and on-screen text ideas short and easy to execute.
- Keep hashtag suggestions relevant and not spammy.
