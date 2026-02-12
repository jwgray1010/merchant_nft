import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { processDueOutbox } from "../jobs/outboxProcessor";
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
  return Math.min(parsed, 200);
}

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /outbox?brandId=main-street-nutrition",
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const records = await adapter.listOutbox(userId, parsedBrandId.data, parseLimit(req.query.limit, 50));
    return res.json(records);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/retry", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /outbox/:id/retry?brandId=main-street-nutrition",
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
    return res.status(400).json({ error: "Missing outbox id route parameter" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const existing = await adapter.getOutboxById(userId, parsedBrandId.data, id);
    if (!existing) {
      return res.status(404).json({ error: `Outbox record '${id}' was not found` });
    }

    await adapter.updateOutbox(id, {
      status: "queued",
      scheduledFor: new Date().toISOString(),
      lastError: null,
    });
    await processDueOutbox(25);
    const refreshed = await adapter.getOutboxById(userId, parsedBrandId.data, id);

    return res.json({
      status: refreshed?.status ?? "queued",
      attempts: refreshed?.attempts ?? existing.attempts,
      lastError: refreshed?.lastError,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
