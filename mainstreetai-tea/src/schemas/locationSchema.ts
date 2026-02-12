import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

const optionalTrimmed = z
  .string()
  .trim()
  .min(1)
  .optional();

export const locationSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  name: z.string().min(1).max(120),
  address: z.string().max(300).optional(),
  timezone: z.string().min(1).default("America/Chicago"),
  googleLocationName: z.string().optional(),
  bufferProfileId: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const locationCreateSchema = z.object({
  name: z.string().min(1).max(120),
  address: optionalTrimmed,
  timezone: optionalTrimmed,
  googleLocationName: optionalTrimmed,
  bufferProfileId: optionalTrimmed,
});

export const locationUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    address: optionalTrimmed,
    timezone: optionalTrimmed,
    googleLocationName: optionalTrimmed,
    bufferProfileId: optionalTrimmed,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export type LocationRecord = z.infer<typeof locationSchema>;
export type LocationCreate = z.infer<typeof locationCreateSchema>;
export type LocationUpdate = z.infer<typeof locationUpdateSchema>;
