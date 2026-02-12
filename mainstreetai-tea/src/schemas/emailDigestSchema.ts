import { z } from "zod";

export const emailDigestSendSchema = z.object({
  to: z.string().email(),
  cadence: z.enum(["weekly", "daily"]),
});

export type EmailDigestSendRequest = z.infer<typeof emailDigestSendSchema>;
