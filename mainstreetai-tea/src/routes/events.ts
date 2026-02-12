import { Router } from "express";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";

const router = Router();

const eventSchema = z.object({
  name: z.string().min(1),
  time: z.string().min(1),
  audience: z.string().min(1),
});

const eventsInputSchema = z.object({
  events: z.array(eventSchema).min(1),
  vibe: z.enum(["loaded-tea", "cafe", "fitness-hybrid"]),
});

const eventsOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      event: z.string(),
      promoIdea: z.string(),
      caption: z.string(),
      simpleOffer: z.string(),
    }),
  ),
});

router.post("/", async (req, res, next) => {
  const parsed = eventsInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await runPrompt({
      promptFile: "events.md",
      input: parsed.data,
      outputSchema: eventsOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
