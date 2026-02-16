import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import {
  mediaAnalyzeRequestSchema,
  mediaAssetCreateSchema,
  mediaUploadUrlRequestSchema,
} from "../schemas/mediaSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  addMediaAsset,
  createMediaUploadUrl,
  listMediaAnalysis,
  listMediaAssets,
} from "../services/mediaStore";
import { analyzeMediaForBrand } from "../services/visualIntelligenceService";

const router = Router();

function parseLimit(value: unknown, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 200);
}

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/media/assets?brandId=main-street-nutrition",
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

router.post("/upload-url", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = mediaUploadUrlRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid upload-url payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const result = await createMediaUploadUrl(userId, parsedBrand.brandId, parsedBody.data);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create upload URL";
    if (message.includes("require STORAGE_MODE=supabase")) {
      return res.status(400).json({ error: message });
    }
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return next(error);
  }
});

router.post("/assets", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = mediaAssetCreateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid media asset payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const asset = await addMediaAsset(userId, parsedBrand.brandId, parsedBody.data);
    return res.status(201).json(asset);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to store media asset";
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return next(error);
  }
});

router.get("/assets", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const assets = await listMediaAssets(userId, parsedBrand.brandId, parseLimit(req.query.limit, 50));
    return res.json(assets);
  } catch (error) {
    return next(error);
  }
});

router.post("/analyze", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = mediaAnalyzeRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid media analyze payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim() !== ""
        ? req.query.locationId.trim()
        : undefined;
    const analyzed = await analyzeMediaForBrand({
      userId,
      brandId: parsedBrand.brandId,
      locationId,
      request: parsedBody.data,
    });
    return res.json({
      asset: analyzed.asset,
      analysis: analyzed.analysis,
      analysisRecordId: analyzed.analysisRecord.id,
      ...(analyzed.cameraPack ?? {}),
      camera: analyzed.cameraPack,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media analysis failed";
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return next(error);
  }
});

router.get("/analysis", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const rows = await listMediaAnalysis(userId, parsedBrand.brandId, {
      limit: parseLimit(req.query.limit, 50),
      assetId: typeof req.query.assetId === "string" ? req.query.assetId : undefined,
    });
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

export default router;
