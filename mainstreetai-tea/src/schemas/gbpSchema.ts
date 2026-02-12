import { z } from "zod";
import { isoDateTimeSchema } from "./scheduleSchema";

export const gbpConnectSchema = z.object({
  locationName: z.string().min(1),
});

export const gbpPostSchema = z.object({
  summary: z.string().min(1).max(1500),
  callToActionUrl: z.string().url().optional(),
  mediaUrl: z.string().url().optional(),
  scheduledFor: isoDateTimeSchema.optional(),
  cta: z.string().min(1).optional(),
  url: z.string().url().optional(),
});

export type GbpConnectRequest = z.infer<typeof gbpConnectSchema>;
export type GbpPostRequest = z.infer<typeof gbpPostSchema>;
