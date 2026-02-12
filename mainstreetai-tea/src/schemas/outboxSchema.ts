import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const outboxTypeSchema = z.enum([
  "post_publish",
  "sms_send",
  "gbp_post",
  "email_send",
]);

export const outboxStatusSchema = z.enum(["queued", "sent", "failed"]);

export const outboxRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  type: outboxTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  status: outboxStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const outboxEnqueueSchema = z.object({
  type: outboxTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});

export const outboxUpdateSchema = z.object({
  status: outboxStatusSchema.optional(),
  attempts: z.number().int().nonnegative().optional(),
  lastError: z.string().nullable().optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});

export type OutboxType = z.infer<typeof outboxTypeSchema>;
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;
export type OutboxRecord = z.infer<typeof outboxRecordSchema>;
export type OutboxEnqueue = z.infer<typeof outboxEnqueueSchema>;
export type OutboxUpdate = z.infer<typeof outboxUpdateSchema>;
