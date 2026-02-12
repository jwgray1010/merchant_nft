import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { runPrompt } from "../ai/runPrompt";
import { brandIdSchema } from "../schemas/brandSchema";
import { nextWeekPlanRequestSchema } from "../schemas/nextWeekPlanRequestSchema";
import { weekPlanOutputSchema } from "../schemas/weekPlanOutputSchema";
import { generateInsights } from "../services/insightsService";

const router = Router();

router.post("/", async (req, res, next) => {
  const parsed = nextWeekPlanRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error:
        "Missing brandId query parameter. Example: /next-week-plan?brandId=main-street-nutrition",
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

    const learning = await generateInsights(brand);

    const result = await runPrompt({
      promptFile: "next_week_plan.md",
      brandProfile: brand,
      input: {
        ...parsed.data,
        brand,
        insights: learning.insights,
        previousWeekPlans: learning.previousWeekPlans,
        recentTopPosts: learning.recentTopPosts,
      },
      outputSchema: weekPlanOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
