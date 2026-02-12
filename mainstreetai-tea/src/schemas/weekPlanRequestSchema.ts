import { z } from "zod";

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "Date must be a valid calendar date",
  });

export const weekPlanRequestSchema = z.object({
  startDate: isoDateSchema,
  weatherWeek: z.string().optional(),
  notes: z.string().optional(),
  goal: z.enum(["new_customers", "repeat_customers", "slow_hours"]),
  focusAudience: z.string().optional(),
});

export type WeekPlanRequest = z.infer<typeof weekPlanRequestSchema>;
