import { z } from "zod";

const optionalTrimmed = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

export const tenantSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().optional(),
  domain: z.string().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().optional(),
  supportEmail: z.string().email().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const tenantBrandingSchema = z.object({
  id: z.string().min(1),
  tenantRef: z.string().min(1),
  appName: z.string().min(1).default("MainStreetAI"),
  tagline: z.string().optional(),
  hideMainstreetaiBranding: z.boolean().default(false),
});

export const tenantResolvedSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().optional(),
  domain: z.string().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().optional(),
  supportEmail: z.string().email().optional(),
  appName: z.string().default("MainStreetAI"),
  tagline: z.string().optional(),
  hideMainstreetaiBranding: z.boolean().default(false),
});

export const tenantSettingsUpsertSchema = z.object({
  name: optionalTrimmed,
  domain: optionalTrimmed.transform((value) => value?.toLowerCase()),
  logoUrl: z.string().url().optional(),
  primaryColor: optionalTrimmed,
  supportEmail: z.string().email().optional(),
  appName: z.string().min(1).optional(),
  tagline: optionalTrimmed,
  hideMainstreetaiBranding: z.boolean().optional(),
});

export type TenantRecord = z.infer<typeof tenantSchema>;
export type TenantBrandingRecord = z.infer<typeof tenantBrandingSchema>;
export type TenantResolved = z.infer<typeof tenantResolvedSchema>;
export type TenantSettingsUpsert = z.infer<typeof tenantSettingsUpsertSchema>;
