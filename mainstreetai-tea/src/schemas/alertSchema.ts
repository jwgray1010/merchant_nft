import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const alertTypeSchema = z.enum([
  "slow_day",
  "low_engagement",
  "missed_post",
  "spike",
  "other",
]);

export const alertSeveritySchema = z.enum(["info", "warning", "urgent"]);
export const alertStatusSchema = z.enum(["open", "acknowledged", "resolved"]);

export const alertSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  type: alertTypeSchema,
  severity: alertSeveritySchema,
  message: z.string().min(1),
  context: z.record(z.string(), z.unknown()).default({}),
  status: alertStatusSchema.default("open"),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
});

export const alertCreateSchema = z.object({
  type: alertTypeSchema,
  severity: alertSeveritySchema,
  message: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
  status: alertStatusSchema.optional().default("open"),
});

export const alertUpdateSchema = z
  .object({
    status: alertStatusSchema.optional(),
    resolvedAt: z.string().datetime({ offset: true }).nullable().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export const anomalyRecommendationsOutputSchema = z.object({
  summary: z.string().min(1),
  actions: z
    .array(
      z.object({
        action: z.string().min(1),
        why: z.string().min(1),
        readyCaption: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
  sms: z.object({
    message: z.string().min(1),
  }),
});

export type AlertType = z.infer<typeof alertTypeSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;
export type AlertStatus = z.infer<typeof alertStatusSchema>;
export type AlertRecord = z.infer<typeof alertSchema>;
export type AlertCreate = z.infer<typeof alertCreateSchema>;
export type AlertUpdate = z.infer<typeof alertUpdateSchema>;
export type AnomalyRecommendationsOutput = z.infer<typeof anomalyRecommendationsOutputSchema>;
