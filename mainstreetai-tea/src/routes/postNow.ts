import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import { postNowRequestSchema } from "../schemas/postNowSchema";
import { getAdapter } from "../storage/getAdapter";
import { runPostNowCoach } from "../services/timingModelService";
import { recordOwnerProgressAction } from "../services/ownerConfidenceService";

const router = Router();

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/post-now?brandId=main-street-nutrition",
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

router.post("/", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = postNowRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid post-now payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.brandAccess?.ownerId ?? req.user?.id;
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

    const result = await runPostNowCoach({
      userId,
      brandId: parsedBrand.brandId,
      request: parsedBody.data,
    });
    await recordOwnerProgressAction({
      ownerId: userId,
      brandId: parsedBrand.brandId,
      actionType: "post_now",
    }).catch(() => {
      // Progress tracking is best-effort.
    });
    return res.json({
      ...result.decision,
      timingModel: result.timingModel.model,
      recentPerformanceSummary: result.recentPerformanceSummary,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
