import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { brandIdSchema } from "../schemas/brandSchema";
import {
  metricsRequestSchema,
  storedMetricsSchema,
  type StoredMetrics,
} from "../schemas/metricsSchema";
import { localJsonStore } from "../storage/localJsonStore";

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

  const createdAt = new Date().toISOString();

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const saveResult = await localJsonStore.saveBrandRecord({
      collection: "metrics",
      brandId: parsedBrandId.data,
      fileSuffix: "metrics",
      record: {
        brandId: parsedBrandId.data,
        createdAt,
        ...parsedBody.data,
      },
    });

    const response = storedMetricsSchema.parse({
      id: saveResult.id,
      brandId: parsedBrandId.data,
      createdAt,
      ...parsedBody.data,
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
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const records = await localJsonStore.listBrandRecords<unknown>({
      collection: "metrics",
      brandId: parsedBrandId.data,
      limit,
    });

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
