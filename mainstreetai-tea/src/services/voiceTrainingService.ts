import { runPrompt } from "../ai/runPrompt";
import { voiceTrainingOutputSchema } from "../schemas/voiceSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  listBrandVoiceSamples,
  upsertBrandVoiceProfile,
} from "./voiceStore";

export const VOICE_TRAIN_SAMPLE_LIMIT = 50;
export const VOICE_TRAIN_RATE_LIMIT_MS = 5 * 60 * 1000;

const recentTraining = new Map<string, number>();

export function canTrainBrandVoiceNow(userId: string, brandId: string): {
  ok: boolean;
  retryAfterMs?: number;
} {
  const key = `${userId}:${brandId}`;
  const now = Date.now();
  const previous = recentTraining.get(key) ?? 0;
  const delta = now - previous;
  if (delta < VOICE_TRAIN_RATE_LIMIT_MS) {
    return {
      ok: false,
      retryAfterMs: VOICE_TRAIN_RATE_LIMIT_MS - delta,
    };
  }
  return { ok: true };
}

export function markBrandVoiceTraining(userId: string, brandId: string): void {
  recentTraining.set(`${userId}:${brandId}`, Date.now());
}

export async function trainBrandVoiceProfile(input: {
  userId: string;
  brandId: string;
}): Promise<{
  profile: Awaited<ReturnType<typeof upsertBrandVoiceProfile>>;
  sampleCount: number;
}> {
  const adapter = getAdapter();
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }

  const samples = await listBrandVoiceSamples(input.userId, input.brandId, VOICE_TRAIN_SAMPLE_LIMIT);
  if (samples.length === 0) {
    throw new Error("Add at least one voice sample before training");
  }

  const trained = await runPrompt({
    promptFile: "voice_training.md",
    brandProfile: brand,
    userId: input.userId,
    input: {
      brand,
      samples: samples.map((sample) => sample.content),
    },
    outputSchema: voiceTrainingOutputSchema,
  });

  const profile = await upsertBrandVoiceProfile(input.userId, input.brandId, {
    styleSummary: trained.style_summary,
    emojiStyle: trained.emoji_style,
    energyLevel: trained.energy_level,
    phrasesToRepeat: trained.phrases_to_repeat,
    doNotUse: trained.phrases_to_avoid,
  });

  markBrandVoiceTraining(input.userId, input.brandId);
  return {
    profile,
    sampleCount: samples.length,
  };
}
