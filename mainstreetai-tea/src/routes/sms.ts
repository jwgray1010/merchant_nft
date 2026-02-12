import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { smsCampaignSchema, smsSendSchema } from "../schemas/smsSchema";
import { getAdapter } from "../storage/getAdapter";
import { getTwilioProvider } from "../integrations/providerFactory";

const router = Router();

function getBrandId(raw: unknown) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const parsed = brandIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

router.post("/send", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error: "Missing or invalid brandId query parameter. Example: /sms/send?brandId=main-street-nutrition",
    });
  }

  const parsedBody = smsSendSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid SMS payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }

    const provider = await getTwilioProvider(userId, brandId);
    const result = await provider.sendSms(parsedBody.data);
    await adapter.addHistory(userId, brandId, "sms-send", parsedBody.data, result);

    return res.json({
      status: "sent",
      result,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/campaign", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /sms/campaign?brandId=main-street-nutrition",
    });
  }

  const parsedBody = smsCampaignSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid SMS campaign payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }

    await getTwilioProvider(userId, brandId);

    const queued = await Promise.all(
      parsedBody.data.recipients.map((to) =>
        adapter.enqueueOutbox(userId, brandId, "sms_send", {
          to,
          message: parsedBody.data.message,
          listName: parsedBody.data.listName,
          optInRequired: true,
        }),
      ),
    );

    return res.status(202).json({
      status: "queued",
      queuedCount: queued.length,
      outboxIds: queued.map((item) => item.id),
      warning: "Only send to recipients that explicitly opted in.",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
