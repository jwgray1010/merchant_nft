import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const voiceSampleSourceSchema = z.enum(["caption", "sms", "email", "manual"]);

export const brandVoiceSampleSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  source: voiceSampleSourceSchema,
  content: z.string().min(1).max(5000),
  createdAt: z.string().datetime({ offset: true }),
});

export const brandVoiceSampleCreateSchema = z.object({
  source: voiceSampleSourceSchema,
  content: z.string().min(1).max(5000),
});

export const voiceEnergyLevelSchema = z.enum(["calm", "friendly", "hype", "luxury"]);

export const brandVoiceProfileSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  embedding: z.record(z.string(), z.unknown()).optional(),
  styleSummary: z.string().optional(),
  emojiStyle: z.string().optional(),
  energyLevel: voiceEnergyLevelSchema.optional(),
  phrasesToRepeat: z.array(z.string()).default([]),
  doNotUse: z.array(z.string()).default([]),
  updatedAt: z.string().datetime({ offset: true }),
});

export const brandVoiceProfileUpsertSchema = z.object({
  embedding: z.record(z.string(), z.unknown()).optional(),
  styleSummary: z.string().min(1).optional(),
  emojiStyle: z.string().min(1).optional(),
  energyLevel: voiceEnergyLevelSchema.optional(),
  phrasesToRepeat: z.array(z.string()).optional(),
  doNotUse: z.array(z.string()).optional(),
});

export const voiceTrainingOutputSchema = z.object({
  style_summary: z.string().min(1),
  emoji_style: z.string().min(1),
  energy_level: voiceEnergyLevelSchema,
  phrases_to_repeat: z.array(z.string()).default([]),
  phrases_to_avoid: z.array(z.string()).default([]),
});

export type VoiceSampleSource = z.infer<typeof voiceSampleSourceSchema>;
export type BrandVoiceSample = z.infer<typeof brandVoiceSampleSchema>;
export type BrandVoiceSampleCreate = z.infer<typeof brandVoiceSampleCreateSchema>;
export type BrandVoiceProfile = z.infer<typeof brandVoiceProfileSchema>;
export type BrandVoiceProfileUpsert = z.infer<typeof brandVoiceProfileUpsertSchema>;
export type VoiceTrainingOutput = z.infer<typeof voiceTrainingOutputSchema>;
