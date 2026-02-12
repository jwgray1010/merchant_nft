import { z } from "zod";
import { businessTypeSchema } from "./brandSchema";
import { dailyGoalSchema } from "./dailyOneButtonSchema";

export const townParticipationLevelSchema = z.enum(["standard", "leader", "hidden"]);

export const townRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().optional(),
  timezone: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});

export const townMembershipSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandRef: z.string().min(1),
  townRef: z.string().min(1),
  participationLevel: townParticipationLevelSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const townRotationSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  brandRef: z.string().min(1),
  lastFeatured: z.string().datetime({ offset: true }),
});

export const townBusinessSummarySchema = z.object({
  name: z.string().min(1),
  type: businessTypeSchema,
});

export const townModePromptOutputSchema = z.object({
  localAngle: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffScript: z.string().min(1),
  optionalCollabIdea: z.string().min(1).optional(),
});

export const dailyTownBoostSchema = z.object({
  line: z.string().min(1),
  captionAddOn: z.string().min(1),
  staffScript: z.string().min(1),
});

export const townMembershipUpdateSchema = z.object({
  enabled: z.boolean().default(true),
  participationLevel: townParticipationLevelSchema.optional(),
  townName: z.string().optional(),
  region: z.string().optional(),
  timezone: z.string().optional(),
});

export const townModeRequestSchema = z.object({
  goal: dailyGoalSchema.optional(),
});

export type TownParticipationLevel = z.infer<typeof townParticipationLevelSchema>;
export type TownRecord = z.infer<typeof townRecordSchema>;
export type TownMembership = z.infer<typeof townMembershipSchema>;
export type TownRotation = z.infer<typeof townRotationSchema>;
export type TownBusinessSummary = z.infer<typeof townBusinessSummarySchema>;
export type TownModePromptOutput = z.infer<typeof townModePromptOutputSchema>;
export type DailyTownBoost = z.infer<typeof dailyTownBoostSchema>;
export type TownMembershipUpdate = z.infer<typeof townMembershipUpdateSchema>;
