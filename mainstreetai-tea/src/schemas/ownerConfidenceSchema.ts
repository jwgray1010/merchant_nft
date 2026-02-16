import { z } from "zod";

export const ownerProgressActionTypeSchema = z.enum([
  "daily_pack",
  "post_now",
  "rescue_used",
  "story_used",
  "camera_post",
]);

export const ownerProgressRowSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandRef: z.string().min(1),
  actionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actionType: ownerProgressActionTypeSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const ownerWinMomentRowSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});

export const ownerConfidenceLevelSchema = z.enum(["low", "steady", "rising"]);

export const ownerConfidenceSummarySchema = z.object({
  confidenceLevel: ownerConfidenceLevelSchema,
  streakDays: z.number().int().min(0).max(365),
  momentumHint: z.string().min(1),
  recentTrend: z.string().min(1),
  shownUpDaysThisWeek: z.number().int().min(0).max(7),
  last7DaysActive: z.array(z.boolean()).length(7),
});

export const ownerConfidencePromptOutputSchema = z.object({
  confidenceLine: z.string().min(1),
});

export type OwnerProgressActionType = z.infer<typeof ownerProgressActionTypeSchema>;
export type OwnerProgressRow = z.infer<typeof ownerProgressRowSchema>;
export type OwnerWinMomentRow = z.infer<typeof ownerWinMomentRowSchema>;
export type OwnerConfidenceLevel = z.infer<typeof ownerConfidenceLevelSchema>;
export type OwnerConfidenceSummary = z.infer<typeof ownerConfidenceSummarySchema>;
