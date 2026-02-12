import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const autopilotCadenceSchema = z.enum(["daily", "weekday", "custom"]);

export const autopilotGoalSchema = z.enum([
  "new_customers",
  "repeat_customers",
  "slow_hours",
]);

export const autopilotChannelSchema = z.enum([
  "facebook",
  "instagram",
  "tiktok",
  "google_business",
  "other",
]);

export const autopilotSettingsSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  enabled: z.boolean().default(false),
  cadence: autopilotCadenceSchema.default("daily"),
  hour: z.number().int().min(0).max(23).default(7),
  timezone: z.string().min(1).default("America/Chicago"),
  goals: z.array(autopilotGoalSchema).default(["repeat_customers", "slow_hours"]),
  focusAudiences: z.array(z.string().min(1)).default([]),
  channels: z.array(autopilotChannelSchema).default(["facebook", "instagram"]),
  allowDiscounts: z.boolean().default(true),
  maxDiscountText: z.string().optional(),
  notifyEmail: z.string().email().optional(),
  notifySms: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const autopilotSettingsUpsertSchema = z.object({
  enabled: z.boolean().optional(),
  cadence: autopilotCadenceSchema.optional(),
  hour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).optional(),
  goals: z.array(autopilotGoalSchema).optional(),
  focusAudiences: z.array(z.string().min(1)).optional(),
  channels: z.array(autopilotChannelSchema).optional(),
  allowDiscounts: z.boolean().optional(),
  maxDiscountText: z.string().optional(),
  notifyEmail: z.string().email().optional(),
  notifySms: z.string().optional(),
});

export const modelInsightsCacheSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  rangeDays: z.number().int().positive().default(30),
  insights: z.record(z.string(), z.unknown()),
  computedAt: z.string().datetime({ offset: true }),
});

export type AutopilotCadence = z.infer<typeof autopilotCadenceSchema>;
export type AutopilotGoal = z.infer<typeof autopilotGoalSchema>;
export type AutopilotChannel = z.infer<typeof autopilotChannelSchema>;
export type AutopilotSettings = z.infer<typeof autopilotSettingsSchema>;
export type AutopilotSettingsUpsert = z.infer<typeof autopilotSettingsUpsertSchema>;
export type ModelInsightsCache = z.infer<typeof modelInsightsCacheSchema>;
