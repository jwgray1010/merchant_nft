import { Router, type Request } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import { brandIdSchema } from "../schemas/brandSchema";
import { brandPartnerUpsertSchema, townGraphEdgeUpdateSchema } from "../schemas/townGraphSchema";
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
import {
  addTownGraphEdge,
  getTownGraph,
  listExplicitPartnersForBrand,
  removeExplicitPartnerForBrand,
  upsertExplicitPartnerForBrand,
} from "../services/townGraphService";
import { recomputeTownMicroRoutesForTown } from "../services/townMicroRoutesService";
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

router.get("/graph", async (req, res, next) => {
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
    const graph = await getTownGraph({
      townId,
      userId: req.user?.id,
    });
    return res.json({
      town: map.town,
      nodes: graph.nodes,
      edges: graph.edges,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/graph/edge", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const parsedBody = townGraphEdgeUpdateSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid town graph edge payload",
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
    const edge = await addTownGraphEdge({
      townId,
      fromCategory: parsedBody.data.fromCategory,
      toCategory: parsedBody.data.toCategory,
      weight: parsedBody.data.weight,
      userId: req.user?.id,
    });
    if (!edge) {
      return res.status(400).json({ error: "fromCategory and toCategory must be different" });
    }
    return res.json({
      ok: true,
      edge: {
        from: edge.fromCategory,
        to: edge.toCategory,
        weight: edge.weight,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/graph/micro-routes/recompute", async (req, res, next) => {
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
    const result = await recomputeTownMicroRoutesForTown({
      townId,
      userId: req.user?.id,
    });
    return res.json({
      ok: true,
      town: map.town,
      updated: result.updated,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/graph/partners", async (req, res, next) => {
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
    const partners = await listExplicitPartnersForBrand({
      userId: access.ownerId,
      brandId: access.brandId,
    });
    return res.json({
      partners,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/graph/partners", async (req, res, next) => {
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
  const parsedBody = brandPartnerUpsertSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid brand partner payload",
      details: parsedBody.error.flatten(),
    });
  }
  try {
    const access = await resolveBrandAccess(actorId, parsedBrandId.data);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    if (!ownerOrAdmin(access.role)) {
      return res.status(403).json({ error: "Only owners/admins can manage explicit partners" });
    }
    const partner = await upsertExplicitPartnerForBrand({
      userId: access.ownerId,
      brandId: access.brandId,
      partnerBrandRef: parsedBody.data.partnerBrandRef,
      relationship: parsedBody.data.relationship,
    });
    if (!partner) {
      return res.status(400).json({ error: "Brand is not linked to a town yet" });
    }
    return res.json({
      ok: true,
      partner,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save partner";
    if (message.toLowerCase().includes("same town")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

router.delete("/graph/partners/:partnerBrandRef", async (req, res, next) => {
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
  const partnerBrandRef = typeof req.params.partnerBrandRef === "string" ? req.params.partnerBrandRef.trim() : "";
  if (!partnerBrandRef) {
    return res.status(400).json({ error: "Missing partnerBrandRef path parameter" });
  }
  try {
    const access = await resolveBrandAccess(actorId, parsedBrandId.data);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    if (!ownerOrAdmin(access.role)) {
      return res.status(403).json({ error: "Only owners/admins can manage explicit partners" });
    }
    const removed = await removeExplicitPartnerForBrand({
      userId: access.ownerId,
      brandId: access.brandId,
      partnerBrandRef,
    });
    return res.json({
      ok: removed,
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
