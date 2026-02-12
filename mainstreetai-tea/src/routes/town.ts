import { Router, type Request } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import { brandIdSchema } from "../schemas/brandSchema";
import { townStoryGenerateRequestSchema } from "../schemas/townStorySchema";
import { townMembershipUpdateSchema } from "../schemas/townSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  getTownMapForUser,
  getTownMembershipForBrand,
  suggestTownFromLocation,
  updateTownMembershipForBrand,
} from "../services/townModeService";
import {
  getTownPulseModel,
  recomputeTownPulseModel,
} from "../services/townPulseService";
import { generateTownStoryForTown, getLatestTownStory } from "../services/townStoriesService";

const router = Router();

function actorUserId(req: Request): string | null {
  const actor = req.user?.actorId ?? req.user?.id;
  return actor ?? null;
}

function ownerOrAdmin(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

router.get("/map", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  try {
    const map = await getTownMapForUser({
      actorUserId: actorId,
      townId,
    });
    if (!map) {
      return res.status(404).json({ error: "Town was not found or is not accessible" });
    }
    return res.json(map);
  } catch (error) {
    return next(error);
  }
});

router.get("/pulse", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  try {
    const map = await getTownMapForUser({
      actorUserId: actorId,
      townId,
    });
    if (!map) {
      return res.status(404).json({ error: "Town was not found or is not accessible" });
    }
    const model = await getTownPulseModel({
      townId,
      userId: req.user?.id,
    });
    return res.json({
      town: map.town,
      model: model?.model ?? null,
      computedAt: model?.computedAt ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/pulse/recompute", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  try {
    const map = await getTownMapForUser({
      actorUserId: actorId,
      townId,
    });
    if (!map) {
      return res.status(404).json({ error: "Town was not found or is not accessible" });
    }
    const model = await recomputeTownPulseModel({
      townId,
      userId: req.user?.id,
      rangeDays: 45,
    });
    return res.json({
      ok: true,
      town: map.town,
      model: model.model,
      computedAt: model.computedAt,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/stories/latest", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  try {
    const map = await getTownMapForUser({
      actorUserId: actorId,
      townId,
    });
    if (!map) {
      return res.status(404).json({ error: "Town was not found or is not accessible" });
    }
    const story = await getLatestTownStory({
      townId,
      userId: req.user?.id,
    });
    return res.json({
      town: map.town,
      story,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/stories/generate", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const parsedBody = townStoryGenerateRequestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid town story payload",
      details: parsedBody.error.flatten(),
    });
  }
  try {
    const map = await getTownMapForUser({
      actorUserId: actorId,
      townId,
    });
    if (!map) {
      return res.status(404).json({ error: "Town was not found or is not accessible" });
    }
    const generated = await generateTownStoryForTown({
      townId,
      userId: req.user?.id,
      storyType: parsedBody.data.storyType,
    });
    return res.json({
      ok: true,
      town: generated.town,
      story: generated.story,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Town story generation failed";
    if (message.toLowerCase().includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return next(error);
  }
});

router.get("/membership", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsedBrandId = brandIdSchema.safeParse(req.query.brandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Missing or invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }
  try {
    const access = await resolveBrandAccess(actorId, parsedBrandId.data);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    const membership = await getTownMembershipForBrand({
      userId: access.ownerId,
      brandId: access.brandId,
    });
    if (!membership) {
      return res.json({
        town: null,
        membership: null,
        enabled: false,
      });
    }
    return res.json({
      town: membership.town,
      membership: membership.membership,
      enabled: membership.membership.participationLevel !== "hidden",
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/membership", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsedBrandId = brandIdSchema.safeParse(req.query.brandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Missing or invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }
  const parsedBody = townMembershipUpdateSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid town membership payload",
      details: parsedBody.error.flatten(),
    });
  }
  try {
    const access = await resolveBrandAccess(actorId, parsedBrandId.data);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    if (!ownerOrAdmin(access.role)) {
      return res.status(403).json({ error: "Only owners/admins can update town membership" });
    }
    const brand = await getAdapter().getBrand(access.ownerId, access.brandId);
    const updated = await updateTownMembershipForBrand({
      userId: access.ownerId,
      brandId: access.brandId,
      fallbackTownName: suggestTownFromLocation(brand?.location ?? ""),
      settings: parsedBody.data,
    });
    return res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Town membership update failed";
    if (message.toLowerCase().includes("town name is required")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

export default router;
