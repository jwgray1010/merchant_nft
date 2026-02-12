import { z } from "zod";

const isoDateSchema = z
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

const weekPlanDaySchema = z.object({
  date: isoDateSchema,
  dayLabel: z.string(),
  promoName: z.string(),
  offer: z.string(),
  timeWindow: z.string(),
  inStoreSign: z.string(),
  post: z.object({
    hook: z.string(),
    caption: z.string(),
    reelShots: z.array(z.string()).length(4),
    onScreenText: z.array(z.string()).length(3),
  }),
  communityTieIn: z.string(),
  staffNotes: z.string(),
});

export const weekPlanOutputSchema = z.object({
  weekTheme: z.string(),
  dailyPlan: z.array(weekPlanDaySchema).length(7),
  postingSchedule: z.object({
    bestTime: z.string(),
    backupTime: z.string(),
  }),
});

export type WeekPlanRequest = z.infer<typeof weekPlanRequestSchema>;
export type WeekPlanOutput = z.infer<typeof weekPlanOutputSchema>;
