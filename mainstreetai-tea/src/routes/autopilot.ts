import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { FEATURES } from "../config/featureFlags";
import { brandIdSchema } from "../schemas/brandSchema";
import { autopilotRunRequestSchema } from "../schemas/autopilotRunSchema";
import { autopilotSettingsUpsertSchema } from "../schemas/autopilotSettingsSchema";
import { runAutopilotForBrand } from "../services/autopilotService";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

function parseBrandId(rawBrandId: unknown) {
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/autopilot/settings?brandId=main-street-nutrition",
      },
    };
  }
  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "Invalid brandId query parameter",
        details: parsedBrandId.error.flatten(),
      },
    };
  }
  return { ok: true as const, brandId: parsedBrandId.data };
}

router.get("/settings", async (req, res, next) => {
  if (!FEATURES.autopilot) {
    return res.status(404).json({ error: "Autopilot feature is disabled" });
  }
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "pro");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }

    const settings =
      (await adapter.getAutopilotSettings(userId, parsedBrand.brandId)) ??
      (await adapter.upsertAutopilotSettings(userId, parsedBrand.brandId, {}));
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
});

router.post("/settings", async (req, res, next) => {
  if (!FEATURES.autopilot) {
    return res.status(404).json({ error: "Autopilot feature is disabled" });
  }
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = autopilotSettingsUpsertSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid autopilot settings payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "pro");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }

    const settings = await adapter.upsertAutopilotSettings(
      userId,
      parsedBrand.brandId,
      parsedBody.data,
    );
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
});

router.post("/run", async (req, res, next) => {
  if (!FEATURES.autopilot) {
    return res.status(404).json({ error: "Autopilot feature is disabled" });
  }
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = autopilotRunRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid autopilot run payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "pro");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const result = await runAutopilotForBrand({
      userId,
      brandId: parsedBrand.brandId,
      request: parsedBody.data,
      source: "api",
    });
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown autopilot error";
    if (message.toLowerCase().includes("already ran")) {
      return res.status(409).json({ error: message });
    }
    return next(error);
  }
});

export default router;
