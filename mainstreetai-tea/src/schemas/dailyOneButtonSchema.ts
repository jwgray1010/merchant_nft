import { z } from "zod";

export const dailyGoalSchema = z.enum(["new_customers", "repeat_customers", "slow_hours"]);
export const dailyPlatformSchema = z.enum(["instagram", "facebook", "tiktok", "gbp", "other"]);

export const dailyRequestSchema = z.object({
  notes: z.string().optional(),
  goal: dailyGoalSchema.optional(),
});

export const localBoostOutputSchema = z.object({
  localAngle: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffLine: z.string().min(1),
});

export const dailyLocalBoostSchema = z.object({
  line: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffScript: z.string().min(1),
});

export const dailyTownBoostSchema = z.object({
  line: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffScript: z.string().min(1),
});

export const dailyTownStorySchema = z.object({
  headline: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffLine: z.string().min(1),
});

export const dailyTownGraphBoostSchema = z.object({
  nextStopIdea: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffLine: z.string().min(1),
});

export const dailyOutputSchema = z.object({
  todaySpecial: z.object({
    promoName: z.string().min(1),
    offer: z.string().min(1),
    timeWindow: z.string().min(1),
    whyThisWorks: z.string().min(1),
  }),
  post: z.object({
    platform: z.string().min(1),
    bestTime: z.string().min(1),
    hook: z.string().min(1),
    caption: z.string().min(1),
    onScreenText: z.array(z.string().min(1)).length(3),
  }),
  sign: z.object({
    headline: z.string().min(1),
    body: z.string().min(1),
    finePrint: z.string().optional(),
  }),
  optionalSms: z.object({
    enabled: z.boolean(),
    message: z.string().min(1),
  }),
  localBoost: dailyLocalBoostSchema.optional(),
  townBoost: dailyTownBoostSchema.optional(),
  townStory: dailyTownStorySchema.optional(),
  townGraphBoost: dailyTownGraphBoostSchema.optional(),
  nextStep: z.string().min(1),
});

export const dailyCheckinOutcomeSchema = z.enum(["slow", "okay", "busy"]);

export const dailyCheckinRequestSchema = z.object({
  outcome: dailyCheckinOutcomeSchema,
  redemptions: z.number().int().min(0).max(100000).optional(),
});

export type DailyGoal = z.infer<typeof dailyGoalSchema>;
export type DailyPlatform = z.infer<typeof dailyPlatformSchema>;
export type DailyRequest = z.infer<typeof dailyRequestSchema>;
export type DailyOutput = z.infer<typeof dailyOutputSchema>;
export type LocalBoostOutput = z.infer<typeof localBoostOutputSchema>;
export type DailyTownBoost = z.infer<typeof dailyTownBoostSchema>;
export type DailyTownStory = z.infer<typeof dailyTownStorySchema>;
export type DailyTownGraphBoost = z.infer<typeof dailyTownGraphBoostSchema>;
export type DailyCheckinRequest = z.infer<typeof dailyCheckinRequestSchema>;
