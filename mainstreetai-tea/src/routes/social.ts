import { Router } from "express";
import { runPrompt } from "../ai/runPrompt";
import { brandIdSchema } from "../schemas/brandSchema";
import { socialOutputSchema, socialRequestSchema } from "../schemas/socialRequestSchema";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

router.post("/", async (req, res, next) => {
  const parsed = socialRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /social?brandId=main-street-nutrition",
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const result = await runPrompt({
      promptFile: "social.md",
      brandProfile: brand,
      input: parsed.data,
      outputSchema: socialOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
