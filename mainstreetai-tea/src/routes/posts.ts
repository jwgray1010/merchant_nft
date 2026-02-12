import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { brandIdSchema } from "../schemas/brandSchema";
import { postRequestSchema, storedPostSchema, type StoredPost } from "../schemas/postSchema";
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

router.post("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /posts?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = postRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid post payload",
      details: parsedBody.error.flatten(),
    });
  }

  const normalizedPostedAt = new Date(parsedBody.data.postedAt).toISOString();
  const createdAt = new Date().toISOString();

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const id = randomUUID();
    await localJsonStore.saveBrandRecord({
      collection: "posts",
      brandId: parsedBrandId.data,
      fileSuffix: "post",
      record: {
        id,
        brandId: parsedBrandId.data,
        createdAt,
        ...parsedBody.data,
        postedAt: normalizedPostedAt,
      },
    });

    const response = storedPostSchema.parse({
      id,
      brandId: parsedBrandId.data,
      createdAt,
      ...parsedBody.data,
      postedAt: normalizedPostedAt,
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
      error: "Missing brandId query parameter. Example: /posts?brandId=main-street-nutrition",
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
      collection: "posts",
      brandId: parsedBrandId.data,
      limit,
    });

    const parsedRecords = records
      .map((record) => storedPostSchema.safeParse(record))
      .filter((result): result is { success: true; data: StoredPost } => result.success)
      .map((result) => result.data);

    return res.json(parsedRecords);
  } catch (error) {
    return next(error);
  }
});

export default router;
