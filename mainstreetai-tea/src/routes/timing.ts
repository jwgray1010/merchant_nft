import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import { mediaPlatformSchema } from "../schemas/mediaSchema";
import { timingRecomputeRequestSchema } from "../schemas/timingSchema";
import { getAdapter } from "../storage/getAdapter";
import { recomputeTimingModel } from "../services/timingModelService";
import { getTimingModel, listTimingModels } from "../services/timingStore";

const router = Router();

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          "Missing brandId query parameter. Example: /api/timing/model?brandId=main-street-nutrition&platform=instagram",
      },
    };
  }
  const parsed = brandIdSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Invalid brandId query parameter",
        details: parsed.error.flatten(),
      },
    };
  }
  return { ok: true, brandId: parsed.data };
}

router.post("/recompute", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = timingRecomputeRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid timing recompute payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const model = await recomputeTimingModel({
      userId,
      brandId: parsedBrand.brandId,
      platform: parsedBody.data.platform,
      rangeDays: parsedBody.data.rangeDays,
    });
    return res.json(model);
  } catch (error) {
    return next(error);
  }
});

router.get("/model", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const platformRaw = typeof req.query.platform === "string" ? req.query.platform : "";
  const parsedPlatform = mediaPlatformSchema.safeParse(platformRaw);

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    if (!parsedPlatform.success) {
      const models = await listTimingModels(userId, parsedBrand.brandId, 10);
      return res.json({
        models,
        warning: "Provide ?platform=... to fetch a single model.",
      });
    }
    const model = await getTimingModel(userId, parsedBrand.brandId, parsedPlatform.data);
    if (!model) {
      return res.status(404).json({
        error: `No timing model found for platform '${parsedPlatform.data}'. Run POST /api/timing/recompute first.`,
      });
    }
    return res.json(model);
  } catch (error) {
    return next(error);
  }
});

export default router;
