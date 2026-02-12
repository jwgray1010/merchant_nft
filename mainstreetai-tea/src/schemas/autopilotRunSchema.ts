import { z } from "zod";
import { autopilotGoalSchema } from "./autopilotSettingsSchema";
import { isoDateSchema } from "./weekPlanRequestSchema";

export const autopilotRunRequestSchema = z.object({
  date: isoDateSchema.optional(),
  goal: autopilotGoalSchema.optional(),
  focusAudience: z.string().optional(),
});

export const autopilotDailyOutputSchema = z.object({
  promo: z.object({
    promoName: z.string().min(1),
    offer: z.string().min(1),
    timeWindow: z.string().min(1),
    inStoreSign: z.string().min(1),
    staffNotes: z.string().min(1),
    upsellSuggestion: z.string().min(1),
  }),
  post: z.object({
    platform: z.enum(["facebook", "instagram", "tiktok", "google_business", "other"]),
    hook: z.string().min(1),
    caption: z.string().min(1),
    reelShots: z.array(z.string().min(1)).length(4),
    onScreenText: z.array(z.string().min(1)).length(3),
    bestPostTime: z.string().min(1),
  }),
  sms: z.object({
    message: z.string().min(1),
  }),
  gbp: z.object({
    summary: z.string().min(1),
    ctaUrl: z.string().url().optional(),
  }),
});

export type AutopilotRunRequest = z.infer<typeof autopilotRunRequestSchema>;
export type AutopilotDailyOutput = z.infer<typeof autopilotDailyOutputSchema>;
