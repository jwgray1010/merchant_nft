import { Router } from "express";
import { z } from "zod";
import { brandIdSchema } from "../schemas/brandSchema";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

const alertListStatusSchema = z.enum(["open", "all"]);

function parseBrandId(rawBrandId: unknown) {
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/alerts?brandId=main-street-nutrition",
      },
    };
  }
  const parsed = brandIdSchema.safeParse(rawBrandId);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "Invalid brandId query parameter",
        details: parsed.error.flatten(),
      },
    };
  }
  return { ok: true as const, brandId: parsed.data };
}

router.get("/", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }

  const parsedStatus = alertListStatusSchema.safeParse(req.query.status ?? "open");
  if (!parsedStatus.success) {
    return res.status(400).json({
      error: "Invalid status query parameter. Use status=open or status=all.",
      details: parsedStatus.error.flatten(),
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
    const alerts = await adapter.listAlerts(userId, parsedBrand.brandId, {
      status: parsedStatus.data,
      limit: 200,
    });
    return res.json(alerts);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/ack", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const alertId = req.params.id?.trim();
  if (!alertId) {
    return res.status(400).json({ error: "Missing alert id route parameter" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const updated = await adapter.updateAlert(userId, parsedBrand.brandId, alertId, {
      status: "acknowledged",
      resolvedAt: null,
    });
    if (!updated) {
      return res.status(404).json({ error: `Alert '${alertId}' was not found` });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/resolve", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const alertId = req.params.id?.trim();
  if (!alertId) {
    return res.status(400).json({ error: "Missing alert id route parameter" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const updated = await adapter.updateAlert(userId, parsedBrand.brandId, alertId, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
    if (!updated) {
      return res.status(404).json({ error: `Alert '${alertId}' was not found` });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

export default router;
