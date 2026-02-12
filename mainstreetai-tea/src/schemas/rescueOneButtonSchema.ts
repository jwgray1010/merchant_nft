import { z } from "zod";

export const rescueRequestSchema = z.object({
  whatHappened: z.string().optional(),
  timeLeftToday: z.string().optional(),
});

export const rescueOutputSchema = z.object({
  rescuePlan: z.object({
    offer: z.string().min(1),
    timeWindow: z.string().min(1),
    inStoreScript: z.string().min(1),
  }),
  post: z.object({
    caption: z.string().min(1),
    hook: z.string().min(1),
    onScreenText: z.array(z.string().min(1)).length(3),
  }),
  sms: z.object({
    message: z.string().min(1),
  }),
  threeQuickActions: z.array(z.string().min(1)).length(3),
});

export type RescueRequest = z.infer<typeof rescueRequestSchema>;
export type RescueOutput = z.infer<typeof rescueOutputSchema>;
