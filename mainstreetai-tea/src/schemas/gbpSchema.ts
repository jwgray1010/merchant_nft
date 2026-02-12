import { z } from "zod";

export const gbpConnectSchema = z.object({
  locationName: z.string().min(1),
});

export const gbpPostSchema = z.object({
  summary: z.string().min(1).max(1500),
  cta: z.string().min(1).optional(),
  url: z.string().url().optional(),
});

export type GbpConnectRequest = z.infer<typeof gbpConnectSchema>;
export type GbpPostRequest = z.infer<typeof gbpPostSchema>;
