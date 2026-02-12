import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { runPrompt } from "../ai/runPrompt";
import { brandIdSchema } from "../schemas/brandSchema";
import { promoOutputSchema, promoRequestSchema } from "../schemas/promoRequestSchema";
import { getUpcomingLocalEvents } from "../services/localEventAwareness";

const router = Router();

router.post("/", async (req, res, next) => {
  const parsed = promoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /promo?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const promptInput = {
      ...parsed.data,
      slowHours: parsed.data.slowHours ?? brand.slowHours,
      ...(parsed.data.includeLocalEvents
        ? { localEvents: await getUpcomingLocalEvents(parsedBrandId.data, 7) }
        : {}),
    };

    const result = await runPrompt({
      promptFile: "promo.md",
      brandProfile: brand,
      input: promptInput,
      outputSchema: promoOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
