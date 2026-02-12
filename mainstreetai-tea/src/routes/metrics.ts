import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import {
  metricsRequestSchema,
  storedMetricsSchema,
  type StoredMetrics,
} from "../schemas/metricsSchema";
import { recordTownPulseFromMetrics } from "../services/townPulseService";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

function parseLimit(value: unknown, defaultValue: number): number {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, 300);
}

router.post("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /metrics?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = metricsRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid metrics payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const response = await adapter.addMetrics(userId, parsedBrandId.data, parsedBody.data);
    await recordTownPulseFromMetrics({
      userId,
      brand,
      metrics: parsedBody.data,
      occurredAt: response.createdAt,
    }).catch(() => {
      // Town Pulse should not block metrics writes.
    });

    return res.status(201).json(response);
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /metrics?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const limit = parseLimit(req.query.limit, 100);

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const records = await adapter.listMetrics(userId, parsedBrandId.data, limit);

    const parsedRecords = records
      .map((record) => storedMetricsSchema.safeParse(record))
      .filter((result): result is { success: true; data: StoredMetrics } => result.success)
      .map((result) => result.data);

    return res.json(parsedRecords);
  } catch (error) {
    return next(error);
  }
});

export default router;
