import { z } from "zod";

export const firstWinFeedbackSchema = z.enum(["slow", "okay", "busy"]);

export const firstWinSessionRowSchema = z.object({
  id: z.string().min(1),
  brandRef: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  completed: z.boolean().default(false),
  resultFeedback: firstWinFeedbackSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const firstWinPromptOutputSchema = z.object({
  offerTitle: z.string().min(1),
  caption: z.string().min(1),
  signText: z.string().min(1),
  staffScript: z.string().min(1),
  timingHint: z.string().min(1),
});

export type FirstWinFeedback = z.infer<typeof firstWinFeedbackSchema>;
export type FirstWinSessionRow = z.infer<typeof firstWinSessionRowSchema>;
export type FirstWinPromptOutput = z.infer<typeof firstWinPromptOutputSchema>;
