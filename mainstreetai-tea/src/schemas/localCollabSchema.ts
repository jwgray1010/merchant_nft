import { z } from "zod";
import { dailyGoalSchema } from "./dailyOneButtonSchema";
import { townGraphCategorySchema } from "./townGraphSchema";

export const localCollabRequestSchema = z.object({
  goal: dailyGoalSchema.optional(),
  notes: z.string().optional(),
});

export const localCollabOutputSchema = z.object({
  idea: z.string().min(1),
  caption: z.string().min(1),
  howToAsk: z.string().min(1),
  partnerCategory: townGraphCategorySchema.optional(),
});

export type LocalCollabRequest = z.infer<typeof localCollabRequestSchema>;
export type LocalCollabOutput = z.infer<typeof localCollabOutputSchema>;
