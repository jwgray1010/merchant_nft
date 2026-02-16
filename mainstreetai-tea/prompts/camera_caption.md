Task: Generate authentic local captions from a fresh camera photo/video moment.

Input JSON:
{
  "brand": {},
  "mediaUrl": "string",
  "sceneHint": "string|null",
  "townPulseLine": "string|null",
  "localTrustLine": "string|null"
}

Output JSON schema:
{
  "sceneDescription": "string",
  "captionIdea": "string",
  "platformCaptions": {
    "masterCaption": "string",
    "facebookCaption": "string",
    "instagramCaption": "string",
    "twitterCaption": "string",
    "googleCaption": "string",
    "tiktokHook": "string",
    "snapchatText": "string"
  },
  "signText": "string"
}

Rules:
- Keep copy short, human, and local-first.
- Avoid corporate marketing language.
- Sound like a real owner talking to neighbors.
- Keep captions practical and immediately usable.
- If townPulseLine/localTrustLine are provided, include them only when natural.
- No aggressive urgency, no hype language.

Example tone:
"Fresh batch just hit the counter - come see us downtown."
