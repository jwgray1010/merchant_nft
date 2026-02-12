import { z } from "zod";
import { postPlatformSchema } from "./postSchema";
import { isoDateTimeSchema } from "./scheduleSchema";

export const publishSourceSchema = z.enum(["promo", "social", "week-plan", "manual"]);

export const publishRequestSchema = z.object({
  platform: postPlatformSchema,
  caption: z.string().min(1),
  mediaUrl: z.string().url().optional(),
  scheduledFor: isoDateTimeSchema.optional(),
  profileId: z.string().min(1).optional(),
  linkUrl: z.string().url().optional(),
  title: z.string().min(1).optional(),
  source: publishSourceSchema.default("manual"),
  scheduleId: z.string().min(1).optional(),
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;
