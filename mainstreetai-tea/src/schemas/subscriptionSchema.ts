import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const billingPlanSchema = z.enum(["free", "starter", "pro"]);
export const subscriptionStatusSchema = z.enum([
  "inactive",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
]);

export const subscriptionRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  plan: billingPlanSchema.default("free"),
  status: subscriptionStatusSchema.default("inactive"),
  currentPeriodEnd: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const subscriptionUpsertSchema = z.object({
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  plan: billingPlanSchema.optional(),
  status: subscriptionStatusSchema.optional(),
  currentPeriodEnd: z.string().datetime({ offset: true }).optional(),
});

export type BillingPlan = z.infer<typeof billingPlanSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type SubscriptionRecord = z.infer<typeof subscriptionRecordSchema>;
export type SubscriptionUpsert = z.infer<typeof subscriptionUpsertSchema>;
