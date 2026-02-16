import { z } from "zod";

export const brandIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "brandId must be a lowercase slug like main-street-nutrition",
  );

export const businessTypeSchema = z.enum([
  "loaded-tea",
  "cafe",
  "fitness-hybrid",
  "restaurant",
  "retail",
  "service",
  "other",
]);

export const brandSupportLevelSchema = z.enum([
  "growing_fast",
  "steady",
  "struggling",
  "just_starting",
]);

export const brandLifecycleStatusSchema = z.enum(["active", "inactive", "closed"]);

export const brandContactPreferenceSchema = z.enum(["sms", "email"]);

export const brandLocalTrustStyleSchema = z.enum([
  "mainstreet",
  "network",
]);

export const brandServiceTagSchema = z.enum([
  "catering",
  "drinks",
  "snacks",
  "fundraising",
  "youth-support",
]);

export const brandConstraintsSchema = z.object({
  noHugeDiscounts: z.boolean(),
  keepPromosSimple: z.boolean(),
  avoidCorporateLanguage: z.boolean(),
  avoidControversy: z.boolean().optional(),
});

export const communityLocalToneSchema = z.enum([
  "neighborly",
  "bold-local",
  "supportive",
  "hometown-pride",
]);

export const communityCollaborationLevelSchema = z.enum(["low", "medium", "high"]);

export const communityAudienceStyleSchema = z.enum([
  "everyone",
  "young-professionals",
  "fitness",
  "blue-collar",
  "creative",
  "mixed",
]);

export const communityVibeProfileSchema = z.object({
  localTone: communityLocalToneSchema.default("neighborly"),
  collaborationLevel: communityCollaborationLevelSchema.default("medium"),
  localIdentityTags: z.array(z.string().min(1)).default([]),
  audienceStyle: communityAudienceStyleSchema.default("mixed"),
  avoidCorporateTone: z.boolean().default(true),
});

export const brandProfileSchema = z.object({
  brandId: brandIdSchema,
  businessName: z.string().min(1),
  location: z.string().min(1),
  status: brandLifecycleStatusSchema.optional(),
  statusReason: z.string().trim().min(1).max(240).optional(),
  statusUpdatedAt: z.string().datetime({ offset: true }).optional(),
  statusUpdatedBy: z.string().min(1).optional(),
  townRef: z.string().min(1).optional(),
  supportLevel: brandSupportLevelSchema.default("steady"),
  localTrustEnabled: z.boolean().default(true),
  localTrustStyle: brandLocalTrustStyleSchema.default("mainstreet"),
  contactPreference: brandContactPreferenceSchema.optional(),
  contactPhone: z.string().trim().min(7).max(40).optional(),
  contactEmail: z.string().email().optional(),
  eventContactPreference: brandContactPreferenceSchema.optional(),
  serviceTags: z.array(brandServiceTagSchema).default([]),
  type: businessTypeSchema,
  voice: z.string().min(1),
  audiences: z.array(z.string()).default([]),
  productsOrServices: z.array(z.string()).default([]),
  hours: z.string().min(1),
  typicalRushTimes: z.string().min(1),
  slowHours: z.string().min(1),
  offersWeCanUse: z.array(z.string()).default([]),
  constraints: brandConstraintsSchema,
  communityVibeProfile: communityVibeProfileSchema.default({
    localTone: "neighborly",
    collaborationLevel: "medium",
    localIdentityTags: [],
    audienceStyle: "mixed",
    avoidCorporateTone: true,
  }),
});

export const brandRegistryItemSchema = z.object({
  brandId: brandIdSchema,
  businessName: z.string().min(1),
  location: z.string().min(1),
  type: businessTypeSchema,
  status: brandLifecycleStatusSchema.optional(),
});

export const brandRegistrySchema = z.array(brandRegistryItemSchema);

export type BrandProfile = z.infer<typeof brandProfileSchema>;
export type BrandRegistryItem = z.infer<typeof brandRegistryItemSchema>;
export type CommunityVibeProfile = z.infer<typeof communityVibeProfileSchema>;
export type BrandSupportLevel = z.infer<typeof brandSupportLevelSchema>;
export type BrandLifecycleStatus = z.infer<typeof brandLifecycleStatusSchema>;
export type BrandContactPreference = z.infer<typeof brandContactPreferenceSchema>;
export type BrandLocalTrustStyle = z.infer<typeof brandLocalTrustStyleSchema>;
export type BrandServiceTag = z.infer<typeof brandServiceTagSchema>;

export function brandLifecycleStatusFor(
  brand: Pick<BrandProfile, "status"> | null | undefined,
): BrandLifecycleStatus {
  const parsed = brandLifecycleStatusSchema.safeParse(brand?.status);
  return parsed.success ? parsed.data : "active";
}

export function isBrandVisibleInTownNetwork(status: BrandLifecycleStatus): boolean {
  return status === "active";
}
