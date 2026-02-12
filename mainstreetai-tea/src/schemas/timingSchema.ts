import { z } from "zod";
import { brandIdSchema } from "./brandSchema";
import { mediaPlatformSchema } from "./mediaSchema";

export const timingHourScoreSchema = z.object({
  hour: z.number().int().min(0).max(23),
  score: z.number(),
  samples: z.number().int().min(0),
});

export const timingDayScoreSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  score: z.number(),
  samples: z.number().int().min(0),
});

export const timingModelDataSchema = z.object({
  rangeDays: z.number().int().min(1).max(365),
  sampleSize: z.number().int().min(0),
  fallbackUsed: z.boolean(),
  hourlyScores: z.array(timingHourScoreSchema).length(24),
  dayOfWeekScores: z.array(timingDayScoreSchema).length(7),
  bestHours: z.array(z.number().int().min(0).max(23)).min(1).max(5),
  bestDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  bestTimeLabel: z.string().min(1),
  explainability: z.object({
    scoreFormula: z.string(),
    decay: z.string(),
    notes: z.array(z.string()).default([]),
  }),
});

export const timingModelRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  platform: mediaPlatformSchema,
  model: timingModelDataSchema,
  computedAt: z.string().datetime({ offset: true }),
});

export const timingRecomputeRequestSchema = z.object({
  platform: mediaPlatformSchema,
  rangeDays: z.number().int().min(7).max(365).optional(),
});

export type TimingModelData = z.infer<typeof timingModelDataSchema>;
export type TimingModelRecord = z.infer<typeof timingModelRecordSchema>;
export type TimingRecomputeRequest = z.infer<typeof timingRecomputeRequestSchema>;
