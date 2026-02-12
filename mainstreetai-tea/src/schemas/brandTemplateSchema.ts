import { z } from "zod";
import { brandConstraintsSchema, brandIdSchema, businessTypeSchema } from "./brandSchema";

export const templateNameSchema = z.enum([
  "loaded-tea",
  "cafe",
  "restaurant",
  "retail",
  "service",
  "gym",
]);

export const brandTemplateSchema = z.object({
  template: templateNameSchema,
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

export const brandFromTemplateRequestSchema = z.object({
  brandId: brandIdSchema,
  businessName: z.string().min(1),
  location: z.string().min(1),
  template: templateNameSchema,
});

export type TemplateName = z.infer<typeof templateNameSchema>;
export type BrandTemplate = z.infer<typeof brandTemplateSchema>;
export type BrandFromTemplateRequest = z.infer<typeof brandFromTemplateRequestSchema>;
