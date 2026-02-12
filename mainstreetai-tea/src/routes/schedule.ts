import { Router } from "express";
import { getBrand } from "../data/brandStore";
import {
  createScheduleItem,
  deleteScheduleItem,
  listScheduleItems,
  updateScheduleItem,
} from "../data/scheduleStore";
import { brandIdSchema } from "../schemas/brandSchema";
import {
  scheduleCreateRequestSchema,
  scheduleItemSchema,
  scheduleUpdateRequestSchema,
} from "../schemas/scheduleSchema";

const router = Router();

function parseOptionalIso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

router.post("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /schedule?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = scheduleCreateRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid schedule payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const created = await createScheduleItem(parsedBrandId.data, parsedBody.data);
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /schedule?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const from = parseOptionalIso(req.query.from);
  const to = parseOptionalIso(req.query.to);

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const items = await listScheduleItems(parsedBrandId.data, { from, to });
    const validated = items.map((item) => scheduleItemSchema.parse(item));
    return res.json(validated);
  } catch (error) {
    return next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /schedule/:id?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = scheduleUpdateRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid schedule update payload",
      details: parsedBody.error.flatten(),
    });
  }

  const id = req.params.id?.trim();
  if (!id) {
    return res.status(400).json({ error: "Missing schedule id route parameter" });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const updated = await updateScheduleItem(parsedBrandId.data, id, parsedBody.data);
    if (!updated) {
      return res.status(404).json({ error: `Schedule item '${id}' was not found` });
    }

    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /schedule/:id?brandId=main-street-nutrition",
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
    return res.status(400).json({ error: "Missing schedule id route parameter" });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const deleted = await deleteScheduleItem(parsedBrandId.data, id);
    if (!deleted) {
      return res.status(404).json({ error: `Schedule item '${id}' was not found` });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
