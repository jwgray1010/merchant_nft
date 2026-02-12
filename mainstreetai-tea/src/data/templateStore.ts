import { readFile } from "node:fs/promises";
import path from "node:path";
import { brandProfileSchema, type BrandProfile } from "../schemas/brandSchema";
import {
  brandFromTemplateRequestSchema,
  brandTemplateSchema,
  type BrandFromTemplateRequest,
  type TemplateName,
} from "../schemas/brandTemplateSchema";

const TEMPLATES_DIR = path.resolve(process.cwd(), "data", "templates");

export const AVAILABLE_TEMPLATE_NAMES: TemplateName[] = [
  "loaded-tea",
  "cafe",
  "restaurant",
  "retail",
  "service",
  "gym",
];

export async function readTemplate(templateName: TemplateName) {
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
  const raw = await readFile(filePath, "utf8");
  return brandTemplateSchema.parse(JSON.parse(raw));
}

export async function buildBrandFromTemplate(
  payload: BrandFromTemplateRequest,
): Promise<BrandProfile> {
  const parsedPayload = brandFromTemplateRequestSchema.parse(payload);
  const template = await readTemplate(parsedPayload.template);

  return brandProfileSchema.parse({
    brandId: parsedPayload.brandId,
    businessName: parsedPayload.businessName,
    location: parsedPayload.location,
    type: template.type,
    voice: template.voice,
    audiences: template.audiences,
    productsOrServices: template.productsOrServices,
    hours: template.hours,
    typicalRushTimes: template.typicalRushTimes,
    slowHours: template.slowHours,
    offersWeCanUse: template.offersWeCanUse,
    constraints: template.constraints,
  });
}
