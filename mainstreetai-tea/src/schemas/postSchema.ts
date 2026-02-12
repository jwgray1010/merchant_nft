import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const postPlatformSchema = z.enum(["facebook", "instagram", "tiktok", "other"]);
export const postMediaTypeSchema = z.enum(["photo", "reel", "story", "text"]);

const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Must be a valid ISO date-time string",
});

export const postRequestSchema = z.object({
  platform: postPlatformSchema,
  postedAt: isoDateTimeSchema,
  mediaType: postMediaTypeSchema,
  captionUsed: z.string().min(1),
  promoName: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const storedPostSchema = postRequestSchema.extend({
  id: z.string(),
  brandId: brandIdSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type PostRequest = z.infer<typeof postRequestSchema>;
export type StoredPost = z.infer<typeof storedPostSchema>;
