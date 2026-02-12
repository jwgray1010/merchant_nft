import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const emailDigestPreviewRequestSchema = z.object({
  rangeDays: z.number().int().min(1).max(90).optional().default(14),
  includeNextWeekPlan: z.boolean().optional().default(true),
  notes: z.string().optional(),
});

export const emailDigestSendRequestSchema = z.object({
  toEmail: z.string().email().optional(),
  rangeDays: z.number().int().min(1).max(90).optional(),
  includeNextWeekPlan: z.boolean().optional(),
  notes: z.string().optional(),
});

export const emailLogStatusSchema = z.enum(["queued", "sent", "failed"]);

export const emailLogSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  toEmail: z.string().email(),
  subject: z.string().min(1),
  status: emailLogStatusSchema,
  providerId: z.string().optional(),
  error: z.string().optional(),
  subscriptionId: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  sentAt: z.string().datetime({ offset: true }).optional(),
});

export const emailLogCreateSchema = z.object({
  toEmail: z.string().email(),
  subject: z.string().min(1),
  status: emailLogStatusSchema.default("queued"),
  providerId: z.string().optional(),
  error: z.string().optional(),
  subscriptionId: z.string().optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
});

export const emailLogUpdateSchema = z
  .object({
    status: emailLogStatusSchema.optional(),
    providerId: z.string().optional(),
    error: z.string().nullable().optional(),
    sentAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type EmailDigestPreviewRequest = z.infer<typeof emailDigestPreviewRequestSchema>;
export type EmailDigestSendRequest = z.infer<typeof emailDigestSendRequestSchema>;
export type EmailLog = z.infer<typeof emailLogSchema>;
export type EmailLogCreate = z.infer<typeof emailLogCreateSchema>;
export type EmailLogUpdate = z.infer<typeof emailLogUpdateSchema>;
