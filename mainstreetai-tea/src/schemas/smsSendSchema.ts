import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const smsPurposeSchema = z.enum(["promo", "reminder", "service", "other"]);
export const smsMessageStatusSchema = z.enum(["queued", "sent", "failed"]);

export const smsSendRequestSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1).max(1000),
  purpose: smsPurposeSchema,
  sendNow: z.boolean().optional(),
});

export const smsMessageSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  toPhone: z.string().min(1),
  body: z.string().min(1),
  status: smsMessageStatusSchema,
  providerMessageId: z.string().optional(),
  error: z.string().optional(),
  purpose: smsPurposeSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  sentAt: z.string().datetime({ offset: true }).optional(),
});

export const smsMessageCreateSchema = z.object({
  toPhone: z.string().min(1),
  body: z.string().min(1),
  status: smsMessageStatusSchema.default("queued"),
  providerMessageId: z.string().optional(),
  error: z.string().optional(),
  purpose: smsPurposeSchema.optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
});

export const smsMessageUpdateSchema = z
  .object({
    status: smsMessageStatusSchema.optional(),
    providerMessageId: z.string().optional(),
    error: z.string().nullable().optional(),
    sentAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type SmsSendRequest = z.infer<typeof smsSendRequestSchema>;
export type SmsMessage = z.infer<typeof smsMessageSchema>;
export type SmsMessageCreate = z.infer<typeof smsMessageCreateSchema>;
export type SmsMessageUpdate = z.infer<typeof smsMessageUpdateSchema>;
