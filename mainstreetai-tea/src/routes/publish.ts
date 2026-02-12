import { Router } from "express";
import { z } from "zod";
import { processDueOutbox } from "../jobs/outboxProcessor";
import { brandIdSchema } from "../schemas/brandSchema";
import { publishRequestSchema } from "../schemas/publishSchema";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

const bufferProfilesSchema = z.object({
  profiles: z
    .array(
      z.object({
        id: z.string().min(1),
        service: z.string().min(1),
        username: z.string().optional(),
      }),
    )
    .default([]),
});

function resolveBufferProfileId(input: {
  platform: "facebook" | "instagram" | "tiktok" | "other";
  profileId?: string;
  profiles: Array<{ id: string; service: string }>;
}): string | null {
  if (input.profileId) {
    const matched = input.profiles.find((profile) => profile.id === input.profileId);
    return matched ? matched.id : null;
  }

  const platformNeedle =
    input.platform === "facebook"
      ? "facebook"
      : input.platform === "instagram"
        ? "instagram"
        : input.platform === "tiktok"
          ? "tiktok"
          : "";
  if (platformNeedle) {
    const matched = input.profiles.find((profile) =>
      profile.service.toLowerCase().includes(platformNeedle),
    );
    if (matched) {
      return matched.id;
    }
  }

  return input.profiles[0]?.id ?? null;
}

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
    let scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor).toISOString() : undefined;
    if (payload.scheduleId && !scheduledFor) {
      const schedule = await adapter.listSchedule(userId, parsedBrandId.data);
      const matched = schedule.find((item) => item.id === payload.scheduleId);
      if (!matched) {
        return res.status(404).json({ error: `Schedule item '${payload.scheduleId}' was not found` });
      }
      scheduledFor = matched.scheduledFor;
    }

    const integration = await adapter.getIntegration(userId, parsedBrandId.data, "buffer");
    if (!integration) {
      return res.status(400).json({ error: "Buffer integration is not connected for this brand" });
    }

    const config = bufferProfilesSchema.parse(integration.config);
    const bufferProfileId = resolveBufferProfileId({
      platform: payload.platform,
      profileId: payload.profileId,
      profiles: config.profiles.map((profile) => ({ id: profile.id, service: profile.service })),
    });
    if (!bufferProfileId) {
      return res.status(400).json({
        error:
          "No Buffer profile matched this request. Connect Buffer and ensure at least one channel is available.",
      });
    }

    const nowIso = new Date().toISOString();
    const shouldQueue = typeof scheduledFor === "string" && new Date(scheduledFor).getTime() > Date.now();

    const outbox = await adapter.enqueueOutbox(
      userId,
      parsedBrandId.data,
      "post_publish",
      {
        platform: payload.platform,
        caption: payload.caption,
        mediaUrl: payload.mediaUrl,
        linkUrl: payload.linkUrl,
        title: payload.title,
        source: payload.source,
        scheduleId: payload.scheduleId,
        bufferProfileId,
      },
      shouldQueue ? scheduledFor : nowIso,
    );

    if (shouldQueue) {
      const plannedPost = await adapter.addPost(userId, parsedBrandId.data, {
        platform: payload.platform,
        postedAt: scheduledFor ?? nowIso,
        mediaType: payload.mediaUrl ? "photo" : "text",
        captionUsed: payload.caption,
        notes: `Queued for Buffer publish (outbox: ${outbox.id})`,
        status: "planned",
        providerMeta: {
          outboxId: outbox.id,
          bufferProfileId,
          source: payload.source,
          linkUrl: payload.linkUrl,
          title: payload.title,
        },
      });

      await adapter.addHistory(
        userId,
        parsedBrandId.data,
        "publish",
        payload,
        {
          queued: true,
          outboxId: outbox.id,
          scheduledFor: outbox.scheduledFor,
          postId: plannedPost.id,
        },
      );

      return res.status(202).json({
        queued: true,
        outboxId: outbox.id,
        scheduledFor: outbox.scheduledFor ?? undefined,
        postId: plannedPost.id,
      });
    }

    await processDueOutbox({
      limit: 10,
      types: ["post_publish"],
    });

    const refreshedOutbox = await adapter.getOutboxById(userId, parsedBrandId.data, outbox.id);
    if (!refreshedOutbox) {
      return res.status(500).json({ error: "Publish queue record disappeared unexpectedly" });
    }

    if (refreshedOutbox.status === "sent") {
      return res.json({
        queued: false,
        outboxId: outbox.id,
        status: "sent",
      });
    }

    if (refreshedOutbox.status === "failed") {
      return res.status(502).json({
        queued: false,
        outboxId: outbox.id,
        status: "failed",
        error: refreshedOutbox.lastError ?? "Buffer publish failed",
      });
    }

    return res.status(202).json({
      queued: true,
      outboxId: outbox.id,
      status: refreshedOutbox.status,
      scheduledFor: refreshedOutbox.scheduledFor ?? undefined,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
