import { z } from "zod";

export const smsCampaignRequestSchema = z.object({
  listTag: z.string().min(1),
  message: z.string().min(1).max(1000),
  dryRun: z.boolean().optional(),
  sendNow: z.boolean().optional(),
});

export type SmsCampaignRequest = z.infer<typeof smsCampaignRequestSchema>;
