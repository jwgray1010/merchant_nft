import { Router, type Request } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import { brandIdSchema } from "../schemas/brandSchema";
import { brandPartnerUpsertSchema, townGraphEdgeUpdateSchema } from "../schemas/townGraphSchema";
import { townSeasonKeySchema, townSeasonUpsertSchema } from "../schemas/townSeasonSchema";
import { townProfileUpsertSchema } from "../schemas/townProfileSchema";
import { townStoryGenerateRequestSchema } from "../schemas/townStorySchema";
import { townMembershipUpdateSchema } from "../schemas/townSchema";
import { townInviteCreateSchema } from "../schemas/townAdoptionSchema";
import { getAdapter } from "../storage/getAdapter";
import { isEmailEnabled } from "../integrations/env";
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
import { deleteTownSeason, listTownSeasons, resolveTownSeasonStateForTown, upsertTownSeason } from "../services/townSeasonService";
import { generateTownStoryForTown, getLatestTownStory } from "../services/townStoriesService";
import { summarizeCommunityImpactForTown } from "../services/communityImpactService";
import { resolveTownProfileForTown, upsertTownProfileForTown } from "../services/townProfileService";
import {
  autoAssignTownAmbassadorForBrand,
  createTownInvite,
  getTownMilestoneSummary,
  resolveOwnedInviterBrandForTown,
  townInviteMessage,
} from "../services/townAdoptionService";
import { parseSeasonOverride } from "../town/seasonDetector";

const router = Router();

function actorUserId(req: Request): string | null {
  const actor = req.user?.actorId ?? req.user?.id;
  return actor ?? null;
}

function ownerOrAdmin(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

function providedCommunityImpactKey(req: Request): string {
  const header = req.headers["x-community-impact-key"];
  if (typeof header === "string") {
    return header.trim();
  }
  if (Array.isArray(header)) {
    return String(header[0] ?? "").trim();
  }
  const query = typeof req.query.communityImpactKey === "string" ? req.query.communityImpactKey : "";
  return query.trim();
}

function isCommunityImpactKeyValid(req: Request): boolean {
  const configured = (process.env.COMMUNITY_IMPACT_DASHBOARD_KEY ?? "").trim();
  if (!configured) {
    return false;
  }
  return providedCommunityImpactKey(req) === configured;
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

router.get("/community-impact", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const validImpactKey = isCommunityImpactKeyValid(req);
  try {
    if (!validImpactKey) {
      const map = await getTownMapForUser({
        actorUserId: actorId,
        townId,
      });
      if (!map) {
        return res.status(404).json({ error: "Town was not found or is not accessible" });
      }
    }
    const summary = await summarizeCommunityImpactForTown({
      townId,
      userId: req.user?.id,
    });
    return res.json({
      activeBusinesses: summary.activeBusinesses,
      townPulseEnergy: summary.townPulseEnergy,
      topCategories: summary.topCategories,
      sponsorship: summary.sponsorship,
      notifications: summary.sponsorship.waitlistNeeded
        ? ["Sponsorship seats are full for current struggling-business demand."]
        : [],
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/milestones", async (req, res, next) => {
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
    const milestone = await getTownMilestoneSummary({
      townId,
      userId: req.user?.id,
    });
    return res.json({
      activeCount: milestone.activeCount,
      featuresUnlocked: milestone.featuresUnlocked,
      launchMessage: milestone.launchMessage ?? null,
      momentumLine: milestone.momentumLine ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/profile", async (req, res, next) => {
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
    const profile = await resolveTownProfileForTown({
      townId,
    });
    return res.json({
      town: map.town,
      profile,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/profile", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const parsedBody = townProfileUpsertSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid town profile payload",
      details: parsedBody.error.flatten(),
    });
  }
  const requestedBrandId = typeof req.query.brandId === "string" ? req.query.brandId.trim() : "";
  if (!requestedBrandId) {
    return res.status(400).json({
      error: "Missing brandId query parameter. Town profile updates require owner/admin access for a town brand.",
    });
  }
  const parsedBrandId = brandIdSchema.safeParse(requestedBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
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
    const access = await resolveBrandAccess(actorId, parsedBrandId.data);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    if (!ownerOrAdmin(access.role)) {
      return res.status(403).json({ error: "Only owners/admins can update TownOS profile settings." });
    }
    const brand = await getAdapter().getBrand(access.ownerId, access.brandId);
    if (!brand?.townRef || brand.townRef !== townId) {
      return res.status(400).json({ error: "Selected brand is not connected to this town." });
    }
    const profile = await upsertTownProfileForTown({
      townId,
      updates: parsedBody.data,
    });
    return res.json({
      ok: true,
      town: map.town,
      profile,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/invite", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsedBody = townInviteCreateSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid invite payload",
      details: parsedBody.error.flatten(),
    });
  }
  const requestedBrandId = typeof req.query.brandId === "string" ? req.query.brandId.trim() : "";
  if (requestedBrandId) {
    const parsedBrandId = brandIdSchema.safeParse(requestedBrandId);
    if (!parsedBrandId.success) {
      return res.status(400).json({
        error: "Invalid brandId query parameter",
        details: parsedBrandId.error.flatten(),
      });
    }
  }
  try {
    const map = await getTownMapForUser({
      actorUserId: actorId,
      townId: parsedBody.data.townId,
    });
    if (!map) {
      return res.status(404).json({ error: "Town was not found or is not accessible" });
    }

    let inviter:
      | {
          ownerId: string;
          brandId: string;
          brandRef: string;
          businessName: string;
        }
      | null = null;
    if (requestedBrandId) {
      const access = await resolveBrandAccess(actorId, requestedBrandId);
      if (!access) {
        return res.status(404).json({ error: `Brand '${requestedBrandId}' was not found` });
      }
      if (!ownerOrAdmin(access.role)) {
        return res.status(403).json({ error: "Only owners/admins can send invites from a brand." });
      }
      inviter = await resolveOwnedInviterBrandForTown({
        ownerId: access.ownerId,
        townId: parsedBody.data.townId,
        preferredBrandId: access.brandId,
      });
    } else {
      const ownerId = req.user?.id;
      if (!ownerId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      inviter = await resolveOwnedInviterBrandForTown({
        ownerId,
        townId: parsedBody.data.townId,
      });
    }
    if (!inviter) {
      return res.status(400).json({
        error: "No eligible inviter brand found in this town. Choose a participating brand and try again.",
      });
    }

    const invite = await createTownInvite({
      townId: parsedBody.data.townId,
      invitedBusiness: parsedBody.data.businessName,
      category: parsedBody.data.category,
      invitedEmail: parsedBody.data.email,
      invitedByBrandRef: inviter.brandRef,
      status: "pending",
    });
    const message = townInviteMessage({
      townName: map.town.name,
      invitedBusiness: parsedBody.data.businessName,
      invitedByBusiness: inviter.businessName,
    });

    let delivery: "recorded" | "email_queued" = "recorded";
    if (parsedBody.data.email && isEmailEnabled()) {
      const adapter = getAdapter();
      const subject = `${map.town.name} Main Street invite`;
      const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:16px;white-space:pre-wrap;">${message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>")}</body></html>`;
      const log = await adapter.addEmailLog(inviter.ownerId, inviter.brandId, {
        toEmail: parsedBody.data.email,
        subject,
        status: "queued",
      });
      await adapter.enqueueOutbox(
        inviter.ownerId,
        inviter.brandId,
        "email_send",
        {
          toEmail: parsedBody.data.email,
          subject,
          html,
          textSummary: message,
          emailLogId: log.id,
        },
        new Date().toISOString(),
      );
      delivery = "email_queued";
    }

    return res.json({
      ok: true,
      invite,
      message,
      delivery,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/seasons", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const rawSeason = typeof req.query.season === "string" ? req.query.season.trim().toLowerCase() : "";
  const seasonOverride = rawSeason ? parseSeasonOverride(rawSeason) : undefined;
  if (rawSeason && !seasonOverride) {
    return res.status(400).json({
      error: "Invalid season query parameter",
      supported: townSeasonKeySchema.options,
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
    const [rows, detected] = await Promise.all([
      listTownSeasons({
        townId,
        userId: req.user?.id,
      }),
      resolveTownSeasonStateForTown({
        townId,
        userId: req.user?.id,
        overrideSeason: seasonOverride,
      }),
    ]);
    return res.json({
      town: map.town,
      seasons: rows,
      detected: detected?.detected ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/seasons", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const parsedBody = townSeasonUpsertSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid season payload",
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
    const row = await upsertTownSeason({
      townId,
      userId: req.user?.id,
      seasonKey: parsedBody.data.seasonKey,
      startDate: parsedBody.data.startDate ?? null,
      endDate: parsedBody.data.endDate ?? null,
      notes: parsedBody.data.notes ?? null,
    });
    return res.json({
      ok: true,
      season: row,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/seasons", async (req, res, next) => {
  const actorId = actorUserId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const townId = typeof req.query.townId === "string" ? req.query.townId.trim() : "";
  if (!townId) {
    return res.status(400).json({ error: "Missing townId query parameter" });
  }
  const rawSeasonKey = typeof req.query.seasonKey === "string" ? req.query.seasonKey.trim().toLowerCase() : "";
  const parsedSeason = townSeasonKeySchema.safeParse(rawSeasonKey);
  if (!parsedSeason.success) {
    return res.status(400).json({
      error: "Missing or invalid seasonKey query parameter",
      details: parsedSeason.error.flatten(),
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
    const deleted = await deleteTownSeason({
      townId,
      seasonKey: parsedSeason.data,
      userId: req.user?.id,
    });
    return res.json({
      ok: deleted,
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
  const rawSeason = typeof req.query.season === "string" ? req.query.season.trim().toLowerCase() : "";
  const seasonOverride = rawSeason ? parseSeasonOverride(rawSeason) : undefined;
  if (rawSeason && !seasonOverride) {
    return res.status(400).json({
      error: "Invalid season query parameter",
      supported: townSeasonKeySchema.options,
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
    const result = await recomputeTownMicroRoutesForTown({
      townId,
      userId: req.user?.id,
      seasonOverride,
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
    const ambassador =
      updated.enabled
        ? await autoAssignTownAmbassadorForBrand({
            ownerId: access.ownerId,
            brandId: access.brandId,
          }).catch(() => null)
        : null;
    return res.json({
      ...updated,
      ambassador,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Town membership update failed";
    if (message.toLowerCase().includes("town name is required")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

export default router;
