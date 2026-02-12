import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const generationEndpointSchema = z.enum([
  "promo",
  "social",
  "events",
  "week-plan",
  "next-week-plan",
]);

export const historyRecordSchema = z.object({
  id: z.string().min(1),
  brandId: brandIdSchema,
  endpoint: generationEndpointSchema,
  createdAt: z.string().datetime({ offset: true }),
  request: z.unknown(),
  response: z.unknown(),
  tags: z.array(z.string()).optional(),
});

export type HistoryRecord = z.infer<typeof historyRecordSchema>;
