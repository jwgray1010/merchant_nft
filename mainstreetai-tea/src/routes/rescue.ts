import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import { rescueRequestSchema } from "../schemas/rescueOneButtonSchema";
import { runRescueOneButton } from "../services/dailyOneButtonService";

const router = Router();

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/rescue?brandId=main-street-nutrition",
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

function isElevated(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

router.post("/", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = rescueRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid rescue payload",
      details: parsedBody.error.flatten(),
    });
  }
  try {
    const ownerId = req.brandAccess?.ownerId ?? req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole;
    if (!isElevated(role)) {
      return res.status(403).json({ error: "Only owners/admins can run rescue generation" });
    }
    const planCheck = await requirePlan(ownerId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim() !== ""
        ? req.query.locationId.trim()
        : undefined;
    const result = await runRescueOneButton({
      userId: ownerId,
      brandId: parsedBrand.brandId,
      locationId,
      request: parsedBody.data,
    });
    return res.json({
      ...result.output,
      confidenceBoostMessage: result.confidenceBoostMessage,
      meta: {
        historyId: result.historyId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rescue generation failed";
    if (message.toLowerCase().includes("marked as closed")) {
      return res.status(409).json({ error: message });
    }
    if (message.toLowerCase().includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return next(error);
  }
});

export default router;
