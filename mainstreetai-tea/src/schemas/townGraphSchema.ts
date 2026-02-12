import { z } from "zod";

export const townGraphCategorySchema = z.enum([
  "cafe",
  "fitness",
  "salon",
  "retail",
  "service",
  "food",
  "other",
]);

export const townGraphEdgeSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  fromCategory: townGraphCategorySchema,
  toCategory: townGraphCategorySchema,
  weight: z.number().min(0.01).max(100000),
  updatedAt: z.string().datetime({ offset: true }),
});

export const townGraphSuggestionIdeaSchema = z.object({
  idea: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffLine: z.string().min(1),
});

export const townGraphPromptOutputSchema = z.object({
  nextStopIdeas: z.array(townGraphSuggestionIdeaSchema).min(1).max(3),
  collabSuggestion: z.string().min(1),
});

export const townGraphSuggestionRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  category: townGraphCategorySchema,
  suggestions: z.object({
    nextStopIdeas: z.array(townGraphSuggestionIdeaSchema).max(3),
    collabSuggestion: z.string().min(1),
  }),
  computedAt: z.string().datetime({ offset: true }),
});

export const townGraphEdgeUpdateSchema = z.object({
  fromCategory: townGraphCategorySchema,
  toCategory: townGraphCategorySchema,
  weight: z.number().min(0.01).max(1000).optional(),
});

export const brandPartnerRelationshipSchema = z.enum(["partner", "favorite", "sponsor"]);

export const brandPartnerRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandRef: z.string().min(1),
  partnerBrandRef: z.string().min(1),
  relationship: brandPartnerRelationshipSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const brandPartnerUpsertSchema = z.object({
  partnerBrandRef: z.string().min(1),
  relationship: brandPartnerRelationshipSchema.optional(),
});

export type TownGraphCategory = z.infer<typeof townGraphCategorySchema>;
export type TownGraphEdge = z.infer<typeof townGraphEdgeSchema>;
export type TownGraphPromptOutput = z.infer<typeof townGraphPromptOutputSchema>;
export type TownGraphSuggestionRow = z.infer<typeof townGraphSuggestionRowSchema>;
export type BrandPartnerRecord = z.infer<typeof brandPartnerRecordSchema>;
