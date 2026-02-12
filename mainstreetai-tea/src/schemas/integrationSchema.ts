import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const integrationProviderSchema = z.enum([
  "buffer",
  "meta",
  "twilio",
  "gmail",
  "sendgrid",
  "google_business",
]);

export const integrationStatusSchema = z.enum([
  "disconnected",
  "connected",
  "error",
  "pending",
]);

export const integrationRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  provider: integrationProviderSchema,
  status: integrationStatusSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  secretsEnc: z.string().min(1).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const integrationUpsertSchema = z.object({
  provider: integrationProviderSchema,
  status: integrationStatusSchema.default("connected"),
  config: z.record(z.string(), z.unknown()).default({}),
  secretsEnc: z.string().min(1).nullable().optional(),
});

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type IntegrationRecord = z.infer<typeof integrationRecordSchema>;
export type IntegrationUpsert = z.infer<typeof integrationUpsertSchema>;
