import { z } from "zod";

export const insightsOutputSchema = z.object({
  summary: z.string(),
  topHooks: z.array(z.string()).length(3),
  topOffers: z.array(z.string()).length(3),
  bestPlatforms: z.array(z.string()).length(2),
  bestPostingTimes: z.array(z.string()).length(2),
  whatToRepeat: z.array(z.string()).length(3),
  whatToAvoid: z.array(z.string()).length(3),
  next7DaysFocus: z.string(),
});

export type InsightsOutput = z.infer<typeof insightsOutputSchema>;
