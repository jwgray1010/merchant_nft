import { z } from "zod";
import { brandIdSchema } from "./brandSchema";
import { postPlatformSchema } from "./postSchema";

const metricValueSchema = z.number().min(0);

export const metricsWindowSchema = z.enum(["24h", "48h", "7d"]);

export const metricsRequestSchema = z.object({
  platform: postPlatformSchema,
  postId: z.string().optional(),
  window: metricsWindowSchema,
  views: metricValueSchema.optional(),
  likes: metricValueSchema.optional(),
  comments: metricValueSchema.optional(),
  shares: metricValueSchema.optional(),
  saves: metricValueSchema.optional(),
  clicks: metricValueSchema.optional(),
  redemptions: metricValueSchema.optional(),
  salesNotes: z.string().optional(),
});

export const storedMetricsSchema = metricsRequestSchema.extend({
  id: z.string(),
  brandId: brandIdSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type MetricsRequest = z.infer<typeof metricsRequestSchema>;
export type StoredMetrics = z.infer<typeof storedMetricsSchema>;
