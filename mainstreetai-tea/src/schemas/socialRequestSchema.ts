import { z } from "zod";

export const socialRequestSchema = z.object({
  todaySpecial: z.string().min(1),
  audience: z.string().min(1),
  tone: z.enum(["fun", "cozy", "hype", "calm"]),
});

export const socialOutputSchema = z.object({
  hookLines: z.array(z.string()).length(3),
  caption: z.string(),
  reelScript: z.object({
    shots: z.array(z.string()).length(4),
    onScreenText: z.array(z.string()).length(3),
    voiceover: z.string(),
  }),
  postVariants: z.object({
    facebook: z.string(),
    instagram: z.string(),
    tiktok: z.string(),
  }),
  hashtags: z.array(z.string()).length(5),
});

export type SocialRequest = z.infer<typeof socialRequestSchema>;
export type SocialOutput = z.infer<typeof socialOutputSchema>;
