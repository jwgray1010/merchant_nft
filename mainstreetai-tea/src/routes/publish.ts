import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { publishRequestSchema } from "../schemas/publishSchema";
import { getAdapter } from "../storage/getAdapter";
import { publishWithBuffer } from "../integrations/providerFactory";

const router = Router();

router.post("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /publish?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = publishRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid publish payload",
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

    const payload = parsedBody.data;
    let scheduledFor: string | undefined;
    if (payload.scheduleId) {
      const schedule = await adapter.listSchedule(userId, parsedBrandId.data);
      const matched = schedule.find((item) => item.id === payload.scheduleId);
      if (!matched) {
        return res.status(404).json({ error: `Schedule item '${payload.scheduleId}' was not found` });
      }
      scheduledFor = matched.scheduledFor;
    }

    const shouldQueue =
      typeof scheduledFor === "string" && new Date(scheduledFor).getTime() > Date.now();
    if (shouldQueue) {
      const outbox = await adapter.enqueueOutbox(
        userId,
        parsedBrandId.data,
        "post_publish",
        {
          platform: payload.platform,
          caption: payload.caption,
          mediaUrl: payload.mediaUrl,
          scheduleId: payload.scheduleId,
        },
        scheduledFor,
      );

      return res.status(202).json({
        status: "queued",
        outboxId: outbox.id,
        scheduledFor: outbox.scheduledFor ?? undefined,
      });
    }

    const result = await publishWithBuffer(userId, parsedBrandId.data, {
      platform: payload.platform,
      caption: payload.caption,
      mediaUrl: payload.mediaUrl,
    });

    const post = await adapter.addPost(userId, parsedBrandId.data, {
      platform: payload.platform,
      postedAt: new Date().toISOString(),
      mediaType: payload.mediaUrl ? "photo" : "text",
      captionUsed: payload.caption,
      promoName: undefined,
      notes: `Published via Buffer${payload.scheduleId ? ` from schedule ${payload.scheduleId}` : ""}`,
    });

    if (payload.scheduleId) {
      await adapter.updateSchedule(userId, parsedBrandId.data, payload.scheduleId, {
        status: "posted",
      });
    }

    await adapter.addHistory(userId, parsedBrandId.data, "publish", payload, result);

    return res.json({
      status: "sent",
      result,
      post,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
