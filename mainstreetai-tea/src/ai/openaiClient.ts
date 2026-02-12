import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}

export function getModelName(): string {
  return getTextModelName();
}

export function getTextModelName(): string {
  return (
    process.env.OPENAI_TEXT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4.1-mini"
  );
}

export function getVisionModelName(): string {
  return (
    process.env.OPENAI_VISION_MODEL?.trim() ||
    process.env.OPENAI_TEXT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4.1-mini"
  );
}
