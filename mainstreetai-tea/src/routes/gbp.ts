import { Router } from "express";
import { z } from "zod";
import { brandIdSchema } from "../schemas/brandSchema";
import { gbpPostSchema } from "../schemas/gbpSchema";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

const gbpIntegrationConfigSchema = z.object({
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        title: z.string().optional(),
      }),
    )
    .default([]),
  locationName: z.string().optional(),
});

router.post("/post", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /gbp/post?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = gbpPostSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid GBP post payload",
      details: parsedBody.error.flatten(),
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

    const integration = await adapter.getIntegration(userId, parsedBrandId.data, "google_business");
    if (!integration) {
      return res.status(400).json({
        error: "Google Business integration is not connected for this brand",
      });
    }

    const config = gbpIntegrationConfigSchema.parse(integration.config);
    const locationName = config.locations[0]?.name ?? config.locationName;
    if (!locationName) {
      return res.status(400).json({
        error:
          "Google Business integration has no locations. Reconnect and grant business location permissions.",
      });
    }

    const ctaUrl = parsedBody.data.callToActionUrl ?? parsedBody.data.url;
    const nowIso = new Date().toISOString();
    const scheduledFor = parsedBody.data.scheduledFor
      ? new Date(parsedBody.data.scheduledFor).toISOString()
      : nowIso;
    const outbox = await adapter.enqueueOutbox(
      userId,
      parsedBrandId.data,
      "gbp_post",
      {
        locationName,
        summary: parsedBody.data.summary,
        callToActionUrl: ctaUrl,
        mediaUrl: parsedBody.data.mediaUrl,
        cta: parsedBody.data.cta,
      },
      scheduledFor,
    );

    return res.status(202).json({
      queued: true,
      outboxId: outbox.id,
      scheduledFor: outbox.scheduledFor ?? undefined,
      warning: "GBP post queued. /api/jobs/outbox cron publishes due posts automatically.",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
