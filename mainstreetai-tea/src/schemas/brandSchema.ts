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

export const brandConstraintsSchema = z.object({
  noHugeDiscounts: z.boolean(),
  keepPromosSimple: z.boolean(),
  avoidCorporateLanguage: z.boolean(),
  avoidControversy: z.boolean().optional(),
});

export const brandProfileSchema = z.object({
  brandId: brandIdSchema,
  businessName: z.string().min(1),
  location: z.string().min(1),
  type: businessTypeSchema,
  voice: z.string().min(1),
  audiences: z.array(z.string()).default([]),
  productsOrServices: z.array(z.string()).default([]),
  hours: z.string().min(1),
  typicalRushTimes: z.string().min(1),
  slowHours: z.string().min(1),
  offersWeCanUse: z.array(z.string()).default([]),
  constraints: brandConstraintsSchema,
});

export const brandRegistryItemSchema = z.object({
  brandId: brandIdSchema,
  businessName: z.string().min(1),
  location: z.string().min(1),
  type: businessTypeSchema,
});

export const brandRegistrySchema = z.array(brandRegistryItemSchema);

export type BrandProfile = z.infer<typeof brandProfileSchema>;
export type BrandRegistryItem = z.infer<typeof brandRegistryItemSchema>;
