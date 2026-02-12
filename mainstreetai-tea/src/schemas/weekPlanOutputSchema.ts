import { z } from "zod";
import { isoDateSchema } from "./weekPlanRequestSchema";

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

export type WeekPlanOutput = z.infer<typeof weekPlanOutputSchema>;
