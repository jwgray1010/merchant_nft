import { z } from "zod";
import { isoDateSchema } from "./weekPlanRequestSchema";

export const nextWeekPlanRequestSchema = z.object({
  startDate: isoDateSchema,
  goal: z.enum(["new_customers", "repeat_customers", "slow_hours"]),
  focusAudience: z.string().optional(),
  notes: z.string().optional(),
  includeLocalEvents: z.boolean().optional(),
});

export type NextWeekPlanRequest = z.infer<typeof nextWeekPlanRequestSchema>;
