import { z } from "zod";
import { postPlatformSchema } from "./postSchema";

export const publishRequestSchema = z.object({
  platform: postPlatformSchema,
  caption: z.string().min(1),
  mediaUrl: z.string().url().optional(),
  scheduleId: z.string().min(1).optional(),
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;
