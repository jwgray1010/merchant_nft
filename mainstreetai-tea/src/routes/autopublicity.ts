import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema, brandLifecycleStatusFor } from "../schemas/brandSchema";
import { autopublicityRequestSchema } from "../schemas/autopublicitySchema";
import { getOwnerConfidenceForBrand, recordOwnerProgressAction } from "../services/ownerConfidenceService";
import { getAdapter } from "../storage/getAdapter";
import { runAutopublicity } from "../services/autopublicityService";

const router = Router();

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/autopublicity?brandId=main-street-nutrition",
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
  const parsedBody = autopublicityRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid autopublicity request payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const ownerId = req.brandAccess?.ownerId ?? req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole;
    if (parsedBody.data.confirmPost && role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Only owners/admins can confirm autopost" });
    }
    const brand = await getAdapter().getBrand(ownerId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    if (brandLifecycleStatusFor(brand) === "closed") {
      return res.status(409).json({
        error: "This business is marked closed. Reactivate it in /admin/businesses before posting.",
      });
    }
    const planCheck = await requirePlan(ownerId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }

    const result = await runAutopublicity({
      ownerId,
      brandId: parsedBrand.brandId,
      mediaUrl: parsedBody.data.mediaUrl,
      captionIdea: parsedBody.data.captionIdea,
      channels: parsedBody.data.channels,
      confirmPost: parsedBody.data.confirmPost,
      locationId: parsedBody.data.locationId,
    });

    const postedSomewhere = Object.values(result.autoPost).some(
      (entry) => entry.requested && (entry.status === "posted" || entry.status === "queued"),
    );
    const shouldRecordCameraProgress = Boolean(
      parsedBody.data.confirmPost && parsedBody.data.cameraMode && postedSomewhere,
    );
    if (shouldRecordCameraProgress) {
      await recordOwnerProgressAction({
        ownerId,
        brandId: parsedBrand.brandId,
        actionType: "camera_post",
      }).catch(() => {
        // Progress tracking should not block posting flow.
      });
    }
    const confidence = shouldRecordCameraProgress
      ? await getOwnerConfidenceForBrand({
          ownerId,
          brandId: parsedBrand.brandId,
          includePromptLine: true,
          minimumLevel: "rising",
        }).catch(() => null)
      : null;

    return res.json({
      confirmed: Boolean(parsedBody.data.confirmPost),
      job: result.job,
      pack: result.pack,
      autoPost: result.autoPost,
      openReady: result.openReady,
      ownerConfidence: confidence
        ? {
            level: confidence.confidenceLevel,
            streakDays: confidence.streakDays,
            line: confidence.line,
          }
        : undefined,
      message: parsedBody.data.confirmPost
        ? "We're posting everywhere possible. Open-ready channels are prepared."
        : "We're ready with your post pack. Confirm when you want to share.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autopublicity failed";
    if (message.toLowerCase().includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return next(error);
  }
});

export default router;
