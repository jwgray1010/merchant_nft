import { Router } from "express";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";

const router = Router();

const promoInputSchema = z.object({
  dateLabel: z.string().min(1),
  weather: z.enum(["cold", "hot", "rainy", "windy", "nice"]),
  slowHours: z.string().min(1),
  inventoryNotes: z.string().optional(),
  vibe: z.enum(["loaded-tea", "cafe", "fitness-hybrid"]),
  goal: z.enum(["new_customers", "repeat_customers", "slow_hours"]),
});

const promoOutputSchema = z.object({
  promoName: z.string(),
  offer: z.string(),
  when: z.string(),
  whoItsFor: z.string(),
  inStoreSign: z.string(),
  socialCaption: z.string(),
  smsText: z.string(),
  staffNotes: z.string(),
  upsellSuggestion: z.string(),
});

router.post("/", async (req, res, next) => {
  const parsed = promoInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await runPrompt({
      promptFile: "promo.md",
      input: parsed.data,
      outputSchema: promoOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
