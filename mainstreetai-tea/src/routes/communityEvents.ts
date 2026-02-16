import { Router } from "express";
import { brandIdSchema, brandLifecycleStatusFor } from "../schemas/brandSchema";
import { eventInterestCreateRequestSchema } from "../schemas/communityEventsSchema";
import {
  buildCommunityOpportunityForBrand,
  generateEventResponseMessage,
  listCommunityOpportunitiesForBrand,
  recordCommunityEventInterest,
} from "../services/communityEventsService";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Missing brandId query parameter. Example: /api/events/opportunities?brandId=main-street-nutrition",
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

function parseLimit(value: unknown, fallback = 5): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 25);
}

router.get("/opportunities", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  try {
    const ownerId = req.brandAccess?.ownerId ?? req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(ownerId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    if (brandLifecycleStatusFor(brand) !== "active") {
      return res.json({
        top: null,
        opportunities: [],
      });
    }
    const [top, opportunities] = await Promise.all([
      buildCommunityOpportunityForBrand({
        ownerId,
        brandId: parsedBrand.brandId,
        brand,
      }).catch(() => null),
      listCommunityOpportunitiesForBrand({
        ownerId,
        brandId: parsedBrand.brandId,
        limit: parseLimit(req.query.limit, 5),
      }).catch(() => []),
    ]);
    return res.json({
      top,
      opportunities,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/interest", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = eventInterestCreateRequestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid event interest payload",
      details: parsedBody.error.flatten(),
    });
  }
  try {
    const ownerId = req.brandAccess?.ownerId ?? req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(ownerId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    if (brandLifecycleStatusFor(brand) !== "active") {
      return res.status(409).json({
        error: "Only active businesses can opt into community opportunities.",
      });
    }
    const hasServiceTags = Array.isArray(brand.serviceTags) && brand.serviceTags.length > 0;
    const hasEventContact =
      Boolean(brand.eventContactPreference) &&
      ((brand.eventContactPreference === "email" && Boolean(brand.contactEmail)) ||
        (brand.eventContactPreference === "sms" && Boolean(brand.contactPhone)));
    const result = await recordCommunityEventInterest({
      ownerId,
      brandId: parsedBrand.brandId,
      request: parsedBody.data,
    });
    const suggestedMessage = await generateEventResponseMessage({
      ownerId,
      brandId: parsedBrand.brandId,
      event: result.event,
      interestType: result.interest.interestType,
      brand,
    }).catch(() => undefined);
    return res.status(201).json({
      ok: true,
      interest: result.interest,
      event: result.event,
      message: suggestedMessage,
      profilePrompt:
        !hasServiceTags || !hasEventContact
          ? {
              neededServiceTags: !hasServiceTags,
              neededEventContact: !hasEventContact,
              currentServiceTags: brand.serviceTags ?? [],
              currentEventContactPreference: brand.eventContactPreference ?? null,
              currentContactEmail: brand.contactEmail ?? null,
              currentContactPhone: brand.contactPhone ?? null,
            }
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save interest";
    if (message.toLowerCase().includes("not found")) {
      return res.status(404).json({ error: message });
    }
    if (message.toLowerCase().includes("outside this brand")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

export default router;

