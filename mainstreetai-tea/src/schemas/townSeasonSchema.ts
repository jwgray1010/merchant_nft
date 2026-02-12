import { z } from "zod";
import { townGraphCategorySchema, townMicroRouteWindowSchema } from "./townGraphSchema";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const townPrimarySeasonSchema = z.enum(["winter", "spring", "summer", "fall"]);

export const townSeasonKeySchema = z.enum([
  "winter",
  "spring",
  "summer",
  "fall",
  "holiday",
  "school",
  "football",
  "basketball",
  "baseball",
  "festival",
]);

export const townSeasonRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  seasonKey: townSeasonKeySchema,
  startDate: z.string().regex(isoDateRegex).nullable().optional(),
  endDate: z.string().regex(isoDateRegex).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const townSeasonUpsertSchema = z.object({
  seasonKey: townSeasonKeySchema,
  startDate: z.string().regex(isoDateRegex).nullable().optional(),
  endDate: z.string().regex(isoDateRegex).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const townRouteSeasonWeightRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  seasonTag: townSeasonKeySchema,
  window: townMicroRouteWindowSchema,
  fromCategory: townGraphCategorySchema,
  toCategory: townGraphCategorySchema,
  weightDelta: z.number().min(-1000).max(1000),
  createdAt: z.string().datetime({ offset: true }),
});

export const townRouteSeasonWeightUpsertSchema = z.object({
  seasonTag: townSeasonKeySchema,
  window: townMicroRouteWindowSchema,
  fromCategory: townGraphCategorySchema,
  toCategory: townGraphCategorySchema,
  weightDelta: z.number().min(-1000).max(1000).default(1),
});

export const detectedTownSeasonSchema = z.object({
  primarySeason: townPrimarySeasonSchema,
  seasonTags: z.array(townSeasonKeySchema),
  seasonNotes: z.record(z.string(), z.string()).default({}),
});

export const townSeasonalRoutePromptOutputSchema = z.object({
  seasonalLine: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffLine: z.string().min(1),
});

export type TownPrimarySeason = z.infer<typeof townPrimarySeasonSchema>;
export type TownSeasonKey = z.infer<typeof townSeasonKeySchema>;
export type TownSeasonRow = z.infer<typeof townSeasonRowSchema>;
export type TownRouteSeasonWeightRow = z.infer<typeof townRouteSeasonWeightRowSchema>;
export type DetectedTownSeason = z.infer<typeof detectedTownSeasonSchema>;
export type TownSeasonalRoutePromptOutput = z.infer<typeof townSeasonalRoutePromptOutputSchema>;
