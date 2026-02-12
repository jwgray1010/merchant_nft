import { z } from "zod";
import { mediaPlatformSchema } from "./mediaSchema";

export const postNowRequestSchema = z.object({
  platform: mediaPlatformSchema,
  todayNotes: z.string().optional(),
  draftCaption: z.string().optional(),
});

export const postNowOutputSchema = z.object({
  postNow: z.boolean(),
  confidence: z.number().min(0).max(1),
  bestTimeToday: z.string().min(1),
  why: z.string().min(1),
  whatToPost: z.object({
    hook: z.string().min(1),
    caption: z.string().min(1),
    onScreenText: z.array(z.string()).min(3).max(6),
  }),
  backupPlan: z.string().min(1),
});

export type PostNowRequest = z.infer<typeof postNowRequestSchema>;
export type PostNowOutput = z.infer<typeof postNowOutputSchema>;
