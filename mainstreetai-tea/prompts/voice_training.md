Task: Analyze multiple voice samples and create a brand voice profile.

Input JSON:
{
  "samples": [string],
  "brand": { ...brandProfile }
}

Output JSON:
{
  "style_summary": string,
  "emoji_style": string,
  "energy_level": "calm|friendly|hype|luxury",
  "phrases_to_repeat": [string],
  "phrases_to_avoid": [string]
}

Rules:
- Keep the summary practical and specific to real wording patterns.
- Base recommendations on repeated language in samples, not generic marketing advice.
- Avoid corporate jargon.
- If sample quality is limited, still return a useful profile with cautious wording.
