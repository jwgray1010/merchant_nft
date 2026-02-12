import { z } from "zod";

export const townPulseCategorySchema = z.enum([
  "cafe",
  "fitness",
  "salon",
  "retail",
  "service",
  "food",
  "mixed",
]);

export const townPulseSignalTypeSchema = z.enum([
  "busy",
  "slow",
  "event_spike",
  "post_success",
]);

export const townPulseSignalSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  category: townPulseCategorySchema,
  signalType: townPulseSignalTypeSchema,
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  weight: z.number().min(0.05).max(50).default(1),
  createdAt: z.string().datetime({ offset: true }),
});

export const townPulseWindowSchema = z.object({
  dow: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
});

export const townPulseModelDataSchema = z.object({
  busyWindows: z.array(townPulseWindowSchema).default([]),
  slowWindows: z.array(townPulseWindowSchema).default([]),
  eventEnergy: z.enum(["low", "medium", "high"]).default("low"),
  seasonalNotes: z.string().min(1),
  categoryTrends: z.array(
    z.object({
      category: townPulseCategorySchema,
      trend: z.enum(["up", "steady", "down"]),
    }),
  ),
});

export const townPulseModelRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  model: townPulseModelDataSchema,
  computedAt: z.string().datetime({ offset: true }),
});

export const townPulsePromptOutputSchema = z.object({
  angle: z.string().min(1),
  captionAddOn: z.string().min(1),
  timingHint: z.string().min(1),
});

export type TownPulseCategory = z.infer<typeof townPulseCategorySchema>;
export type TownPulseSignalType = z.infer<typeof townPulseSignalTypeSchema>;
export type TownPulseSignal = z.infer<typeof townPulseSignalSchema>;
export type TownPulseModelData = z.infer<typeof townPulseModelDataSchema>;
export type TownPulseModelRow = z.infer<typeof townPulseModelRowSchema>;
export type TownPulsePromptOutput = z.infer<typeof townPulsePromptOutputSchema>;
