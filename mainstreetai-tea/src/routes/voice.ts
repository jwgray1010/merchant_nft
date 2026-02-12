import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import { brandVoiceSampleCreateSchema } from "../schemas/voiceSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  MAX_VOICE_SAMPLES_PER_BRAND,
  addBrandVoiceSample,
  getBrandVoiceProfile,
  listBrandVoiceSamples,
} from "../services/voiceStore";
import { canTrainBrandVoiceNow, trainBrandVoiceProfile } from "../services/voiceTrainingService";

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
        error:
          "Missing brandId query parameter. Example: /api/voice/samples?brandId=main-street-nutrition",
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

function isElevatedRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

router.get("/samples", async (req, res, next) => {
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
    const samples = await listBrandVoiceSamples(
      userId,
      parsedBrand.brandId,
      parseLimit(req.query.limit, 50),
    );
    const profile = await getBrandVoiceProfile(userId, parsedBrand.brandId);
    return res.json({
      samples,
      profile,
      maxSamples: MAX_VOICE_SAMPLES_PER_BRAND,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/samples", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = brandVoiceSampleCreateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid voice sample payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Only owner/admin can add voice samples" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const sample = await addBrandVoiceSample(userId, parsedBrand.brandId, parsedBody.data);
    return res.status(201).json(sample);
  } catch (error) {
    return next(error);
  }
});

router.post("/train", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Only owner/admin can train brand voice" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }

    const rateLimit = canTrainBrandVoiceNow(userId, parsedBrand.brandId);
    if (!rateLimit.ok) {
      return res.status(429).json({
        error: "Voice training is rate limited. Please wait before training again.",
        retryAfterMs: rateLimit.retryAfterMs,
      });
    }

    const result = await trainBrandVoiceProfile({
      userId,
      brandId: parsedBrand.brandId,
    });
    return res.json({
      ok: true,
      sampleCount: result.sampleCount,
      profile: result.profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice training failed";
    if (message.toLowerCase().includes("add at least one voice sample")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

export default router;
