import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { deleteLocalEvent, getLocalEvents, upsertLocalEvents } from "../data/localEventsStore";
import { brandIdSchema } from "../schemas/brandSchema";
import { localEventsUpsertSchema } from "../schemas/localEventsSchema";

const router = Router();

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /local-events?brandId=main-street-nutrition",
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
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const data = await getLocalEvents(parsedBrandId.data);
    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /local-events?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  // Accept either strict upsert payload or direct full-set payload.
  const parsedBody = localEventsUpsertSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid local events payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const updated = await upsertLocalEvents(parsedBrandId.data, parsedBody.data);
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:eventId", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error:
        "Missing brandId query parameter. Example: /local-events/<eventId>?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const eventId = req.params.eventId?.trim();
  if (!eventId) {
    return res.status(400).json({ error: "Missing eventId route parameter" });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const deleted = await deleteLocalEvent(parsedBrandId.data, eventId);
    if (!deleted) {
      return res.status(404).json({ error: `Local event '${eventId}' was not found` });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
