import { z } from "zod";
import { brandContactPreferenceSchema } from "./brandSchema";

export const townAmbassadorRoleSchema = z.enum([
  "ambassador",
  "local_leader",
  "organizer",
]);

export const townAmbassadorRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  brandRef: z.string().min(1),
  role: townAmbassadorRoleSchema.default("ambassador"),
  joinedAt: z.string().datetime({ offset: true }),
});

export const townInviteStatusSchema = z.enum([
  "pending",
  "sent",
  "accepted",
  "declined",
]);

export const townInviteCreateSchema = z.object({
  townId: z.string().min(1),
  businessName: z.string().min(1),
  phone: z.string().trim().min(7).max(40).optional(),
  email: z.string().email().optional(),
  category: z.string().min(1).default("other"),
  contactPreference: brandContactPreferenceSchema.optional(),
  confirmClosedReuse: z.boolean().optional(),
});

export const townInviteRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  invitedBusiness: z.string().min(1),
  invitedByBrandRef: z.string().min(1),
  category: z.string().min(1),
  inviteCode: z.string().min(4).optional(),
  contactPreference: brandContactPreferenceSchema.optional(),
  invitedPhone: z.string().trim().min(7).max(40).optional(),
  invitedEmail: z.string().email().optional(),
  status: townInviteStatusSchema.default("pending"),
  createdAt: z.string().datetime({ offset: true }),
});

export const townSuccessSignalSchema = z.enum([
  "busy_days_up",
  "repeat_customers_up",
  "new_faces_seen",
]);

export const townSuccessSignalRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  signal: townSuccessSignalSchema,
  weight: z.number().min(0.01).max(1000).default(1),
  createdAt: z.string().datetime({ offset: true }),
});

export const townFeatureUnlockSchema = z.enum([
  "town_stories",
  "town_pulse_learning",
  "town_graph_routes",
]);

export const townMilestoneSummarySchema = z.object({
  activeCount: z.number().int().min(0),
  featuresUnlocked: z.array(townFeatureUnlockSchema),
  launchMessage: z.string().optional(),
  momentumLine: z.string().optional(),
});

export type TownAmbassadorRole = z.infer<typeof townAmbassadorRoleSchema>;
export type TownAmbassadorRow = z.infer<typeof townAmbassadorRowSchema>;
export type TownInviteStatus = z.infer<typeof townInviteStatusSchema>;
export type TownInviteCreate = z.infer<typeof townInviteCreateSchema>;
export type TownInviteRow = z.infer<typeof townInviteRowSchema>;
export type TownSuccessSignal = z.infer<typeof townSuccessSignalSchema>;
export type TownSuccessSignalRow = z.infer<typeof townSuccessSignalRowSchema>;
export type TownFeatureUnlock = z.infer<typeof townFeatureUnlockSchema>;
export type TownMilestoneSummary = z.infer<typeof townMilestoneSummarySchema>;
