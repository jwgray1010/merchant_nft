import { z } from "zod";

export const townStoryTypeSchema = z.enum(["weekly", "daily", "event"]);

export const townStoryContentSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  socialCaption: z.string().min(1),
  conversationStarter: z.string().min(1),
  signLine: z.string().min(1),
});

export const townStoryRecordSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  storyType: townStoryTypeSchema,
  content: townStoryContentSchema,
  generatedAt: z.string().datetime({ offset: true }),
});

export const townStoryUsageSchema = z.object({
  id: z.string().min(1),
  townStoryRef: z.string().min(1),
  brandRef: z.string().min(1),
  usedAt: z.string().datetime({ offset: true }),
});

export const townStoryGenerateRequestSchema = z.object({
  storyType: townStoryTypeSchema.optional(),
});

export type TownStoryType = z.infer<typeof townStoryTypeSchema>;
export type TownStoryContent = z.infer<typeof townStoryContentSchema>;
export type TownStoryRecord = z.infer<typeof townStoryRecordSchema>;
export type TownStoryUsage = z.infer<typeof townStoryUsageSchema>;
