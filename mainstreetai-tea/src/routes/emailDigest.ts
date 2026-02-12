import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { emailDigestSendSchema } from "../schemas/emailDigestSchema";
import { processDueOutbox } from "../jobs/outboxProcessor";
import { buildDigestPreview } from "../services/digestService";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

router.post("/digest/preview", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /email/digest/preview?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const cadence = req.query.cadence === "daily" ? "daily" : "weekly";

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

    const preview = await buildDigestPreview(userId, parsedBrandId.data, cadence);
    return res.json(preview);
  } catch (error) {
    return next(error);
  }
});

router.post("/digest/send", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /email/digest/send?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = emailDigestSendSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid email digest payload",
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

    const outbox = await adapter.enqueueOutbox(userId, parsedBrandId.data, "email_send", {
      template: "digest",
      cadence: parsedBody.data.cadence,
      to: parsedBody.data.to,
    });

    await processDueOutbox(25);
    const refreshed = await adapter.getOutboxById(userId, parsedBrandId.data, outbox.id);

    return res.status(202).json({
      outboxId: outbox.id,
      status: refreshed?.status ?? outbox.status,
      attempts: refreshed?.attempts ?? outbox.attempts,
      lastError: refreshed?.lastError,
      warning:
        parsedBody.data.cadence === "weekly"
          ? "Weekly cadence selected. Schedule recurring calls to this endpoint from cron."
          : "Daily cadence selected. Schedule recurring calls to this endpoint from cron.",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
