import { Router } from "express";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";

const router = Router();

const socialInputSchema = z.object({
  todaySpecial: z.string().min(1),
  vibe: z.enum(["loaded-tea", "cafe", "fitness-hybrid"]),
  audience: z.enum(["teachers", "parents", "teens", "gym", "general"]),
  tone: z.enum(["fun", "cozy", "hype", "calm"]),
});

const socialOutputSchema = z.object({
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

router.post("/", async (req, res, next) => {
  const parsed = socialInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await runPrompt({
      promptFile: "social.md",
      input: parsed.data,
      outputSchema: socialOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
