import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const emailCadenceSchema = z.enum(["daily", "weekly"]);

const dayOfWeekSchema = z.number().int().min(0).max(6);
const hourSchema = z.number().int().min(0).max(23);

export const emailSubscriptionSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  toEmail: z.string().email(),
  cadence: emailCadenceSchema,
  dayOfWeek: dayOfWeekSchema.optional(),
  hour: hourSchema.optional(),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime({ offset: true }),
});

export const emailSubscriptionUpsertSchema = z.object({
  toEmail: z.string().email(),
  cadence: emailCadenceSchema,
  dayOfWeek: dayOfWeekSchema.optional(),
  hour: hourSchema.optional(),
  enabled: z.boolean().optional(),
});

export const emailSubscriptionUpdateSchema = z
  .object({
    toEmail: z.string().email().optional(),
    cadence: emailCadenceSchema.optional(),
    dayOfWeek: dayOfWeekSchema.optional(),
    hour: hourSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type EmailCadence = z.infer<typeof emailCadenceSchema>;
export type EmailSubscription = z.infer<typeof emailSubscriptionSchema>;
export type EmailSubscriptionUpsert = z.infer<typeof emailSubscriptionUpsertSchema>;
export type EmailSubscriptionUpdate = z.infer<typeof emailSubscriptionUpdateSchema>;
