import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { brandIdSchema } from "../schemas/brandSchema";
import { historyRecordSchema, type HistoryRecord } from "../schemas/historySchema";
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

  return Math.min(parsed, 200);
}

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /history?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const limit = parseLimit(req.query.limit, 50);

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const records = await localJsonStore.listBrandRecords<unknown>({
      collection: "history",
      brandId: parsedBrandId.data,
      limit,
    });

    const parsedRecords = records
      .map((record) => historyRecordSchema.safeParse(record))
      .filter((result): result is { success: true; data: HistoryRecord } => result.success)
      .map((result) => result.data);

    return res.json(parsedRecords);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /history/<id>?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const id = req.params.id?.trim();
  if (!id) {
    return res.status(400).json({ error: "Missing history id route parameter" });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const record = await localJsonStore.getBrandRecordById<unknown>({
      collection: "history",
      brandId: parsedBrandId.data,
      id,
    });

    if (!record) {
      return res.status(404).json({ error: `History record '${id}' was not found` });
    }

    const parsedRecord = historyRecordSchema.safeParse(record);
    if (!parsedRecord.success) {
      return res.status(404).json({ error: `History record '${id}' was not valid` });
    }

    return res.json(parsedRecord.data);
  } catch (error) {
    return next(error);
  }
});

export default router;
