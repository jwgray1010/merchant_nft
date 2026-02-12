import { z } from "zod";

const phoneNumberSchema = z
  .string()
  .regex(/^\+\d{10,15}$/, "Phone number must be in E.164 format (e.g. +15555550123)");

export const smsSendSchema = z.object({
  to: phoneNumberSchema,
  message: z.string().min(1).max(1000),
});

export const smsCampaignSchema = z.object({
  listName: z.enum(["teachers", "vip", "gym", "general"]),
  recipients: z.array(phoneNumberSchema).min(1).max(500),
  message: z.string().min(1).max(1000),
});

export type SmsSendRequest = z.infer<typeof smsSendSchema>;
export type SmsCampaignRequest = z.infer<typeof smsCampaignSchema>;
