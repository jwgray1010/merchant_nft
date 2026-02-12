import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BrandProfile } from "../schemas/brandSchema";
import type { BrandVoiceProfile } from "../schemas/voiceSchema";
import { getBrandVoiceProfile } from "../services/voiceStore";
import { getModelName, getOpenAIClient } from "./openaiClient";

type RunPromptOptions<TOutput> = {
  promptFile: string;
  brandProfile: BrandProfile;
  userId?: string;
  locationContext?: {
    id?: string;
    name?: string;
    address?: string;
    timezone?: string;
  };
  input: unknown;
  outputSchema: z.ZodType<TOutput>;
};

function getPromptsDir(): string {
  return path.resolve(process.cwd(), "prompts");
}

async function loadPrompt(fileName: string): Promise<string> {
  const promptPath = path.join(getPromptsDir(), fileName);
  return readFile(promptPath, "utf8");
}

function isResponseFormatUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /response_format/i.test(message) && /unsupported|not supported|invalid/i.test(message);
}

function parseModelJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (fencedJson) {
      return JSON.parse(fencedJson.trim());
    }

    const fencedAny = raw.match(/```([\s\S]*?)```/i)?.[1];
    if (fencedAny) {
      return JSON.parse(fencedAny.trim());
    }

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error("Model response is not valid JSON");
  }
}

function buildComposedPrompt(
  systemPrompt: string,
  taskPrompt: string,
  brandProfile: BrandProfile,
  voiceProfile: BrandVoiceProfile | null,
  locationContext:
    | {
        id?: string;
        name?: string;
        address?: string;
        timezone?: string;
      }
    | undefined,
  input: unknown,
): string {
  const voiceSection = voiceProfile
    ? [
        "",
        "BRAND VOICE PROFILE",
        `- Style summary: ${voiceProfile.styleSummary ?? "Not trained yet"}`,
        `- Emoji style: ${voiceProfile.emojiStyle ?? "Natural/minimal"}`,
        `- Energy level: ${voiceProfile.energyLevel ?? "friendly"}`,
        `- Phrases to repeat: ${(voiceProfile.phrasesToRepeat ?? []).join(" | ") || "none"}`,
        `- Phrases to avoid: ${(voiceProfile.doNotUse ?? []).join(" | ") || "none"}`,
      ].join("\n")
    : "";

  const locationSection = locationContext
    ? [
        "",
        "LOCATION CONTEXT",
        JSON.stringify(
          {
            id: locationContext.id,
            name: locationContext.name,
            address: locationContext.address,
            timezone: locationContext.timezone,
          },
          null,
          2,
        ),
        `Speak as if this content is for location: ${locationContext.name}.`,
      ].join("\n")
    : "";

  return [
    systemPrompt.trim(),
    "",
    "BRAND PROFILE (JSON, pretty printed)",
    JSON.stringify(brandProfile, null, 2),
    voiceSection,
    locationSection,
    "",
    "TASK PROMPT",
    taskPrompt.trim(),
    "",
    "USER INPUT (JSON)",
    JSON.stringify(input, null, 2),
    "",
    "Return JSON ONLY. Do not include markdown fences or extra commentary.",
  ].join("\n");
}

async function requestModel(prompt: string): Promise<string> {
  const openai = getOpenAIClient();
  const model = getModelName();
  const baseRequest = {
    model,
    messages: [{ role: "user" as const, content: prompt }],
  };

  try {
    const completion = await openai.chat.completions.create({
      ...baseRequest,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("Model returned an empty response");
    }
    return raw;
  } catch (error) {
    if (!isResponseFormatUnsupported(error)) {
      throw error;
    }
  }

  const completion = await openai.chat.completions.create(baseRequest);
  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Model returned an empty response");
  }
  return raw;
}

function formatValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return JSON.stringify(error.issues, null, 2);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown parse/validation error";
}

async function safeLoadVoiceProfile(
  userId: string | undefined,
  brandId: string,
): Promise<BrandVoiceProfile | null> {
  if (!userId) {
    return null;
  }
  try {
    return await getBrandVoiceProfile(userId, brandId);
  } catch {
    // Missing Phase 11 tables should not break content generation.
    return null;
  }
}

export async function runPrompt<TOutput>({
  promptFile,
  brandProfile,
  userId,
  locationContext,
  input,
  outputSchema,
}: RunPromptOptions<TOutput>): Promise<TOutput> {
  const [systemPrompt, taskPrompt, voiceProfile] = await Promise.all([
    loadPrompt("system.md"),
    loadPrompt(promptFile),
    safeLoadVoiceProfile(userId, brandProfile.brandId),
  ]);

  const composedPrompt = buildComposedPrompt(
    systemPrompt,
    taskPrompt,
    brandProfile,
    voiceProfile,
    locationContext,
    input,
  );
  const firstRaw = await requestModel(composedPrompt);

  try {
    const firstParsed = parseModelJson(firstRaw);
    return outputSchema.parse(firstParsed);
  } catch (firstError) {
    const repairPrompt = [
      composedPrompt,
      "",
      "The previous response was invalid or did not match schema.",
      "Validation/parsing error details:",
      formatValidationError(firstError),
      "",
      "Previous response:",
      firstRaw,
      "",
      "Retry now. Return ONLY valid JSON that matches the schema from TASK PROMPT.",
    ].join("\n");

    const repairRaw = await requestModel(repairPrompt);
    const repairedParsed = parseModelJson(repairRaw);
    return outputSchema.parse(repairedParsed);
  }
}
