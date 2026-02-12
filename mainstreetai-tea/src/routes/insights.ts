import { Router } from "express";
import { z } from "zod";
import { getBrand } from "../data/brandStore";
import { brandIdSchema } from "../schemas/brandSchema";
import { insightsOutputSchema } from "../schemas/insightsOutputSchema";
import { generateInsights } from "../services/insightsService";
import { localJsonStore } from "../storage/localJsonStore";

const router = Router();

const cachedInsightsSchema = z.object({
  brandId: brandIdSchema,
  computedAt: z.string().datetime({ offset: true }),
  window: z.object({
    days: z.number(),
    maxEntries: z.number(),
  }),
  sampleSizes: z.object({
    history: z.number(),
    posts: z.number(),
    metrics: z.number(),
  }),
  aggregates: z.record(z.string(), z.unknown()),
  insights: insightsOutputSchema,
});

async function buildInsightsPayload(brandId: string) {
  const brand = await getBrand(brandId);
  if (!brand) {
    return { error: `Brand '${brandId}' was not found` } as const;
  }

  const result = await generateInsights(brand);

  return {
    brandId,
    computedAt: new Date().toISOString(),
    window: {
      days: 30,
      maxEntries: 100,
    },
    sampleSizes: {
      history: result.history.length,
      posts: result.posts.length,
      metrics: result.metrics.length,
    },
    aggregates: result.aggregates,
    insights: result.insights,
  };
}

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /insights?brandId=main-street-nutrition",
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
    const payload = await buildInsightsPayload(parsedBrandId.data);
    if ("error" in payload) {
      return res.status(404).json({ error: payload.error });
    }

    return res.json(payload);
  } catch (error) {
    try {
      const cached = await localJsonStore.readBrandInsight<unknown>(parsedBrandId.data);
      const parsedCached = cachedInsightsSchema.safeParse(cached);
      if (parsedCached.success) {
        return res.json({
          ...parsedCached.data,
          cacheFallback: true,
        });
      }
    } catch {
      // ignore cache fallback errors
    }

    return next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /insights/refresh?brandId=main-street-nutrition",
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
    const payload = await buildInsightsPayload(parsedBrandId.data);
    if ("error" in payload) {
      return res.status(404).json({ error: payload.error });
    }

    const parsedPayload = cachedInsightsSchema.parse(payload);
    await localJsonStore.writeBrandInsight(parsedBrandId.data, parsedPayload);
    return res.json(parsedPayload);
  } catch (error) {
    return next(error);
  }
});

export default router;
