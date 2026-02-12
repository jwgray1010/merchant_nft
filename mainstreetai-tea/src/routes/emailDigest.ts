import { Router, type Request, type Response } from "express";
import { requirePlan } from "../billing/requirePlan";
import { FEATURES } from "../config/featureFlags";
import { brandIdSchema } from "../schemas/brandSchema";
import {
  emailSubscriptionUpdateSchema,
  emailSubscriptionUpsertSchema,
} from "../schemas/emailSubscriptionSchema";
import {
  emailDigestPreviewRequestSchema,
  emailDigestSendRequestSchema,
} from "../schemas/emailSendSchema";
import { buildDigestPreview } from "../services/digestService";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

router.use((_req, res, next) => {
  if (!FEATURES.billing) {
    return res.status(404).json({ error: "Email digest feature is disabled" });
  }
  return next();
});

function parseBrandId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const parsed = brandIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseLimit(raw: unknown, fallback = 50): number {
  if (typeof raw !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 500);
}

async function enforceEmailProAccess(
  req: Request,
  res: Response,
  userId: string,
  brandId: string,
): Promise<boolean> {
  const role = req.brandAccess?.role ?? req.user?.brandRole;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Insufficient role permissions" });
    return false;
  }
  const planCheck = await requirePlan(userId, brandId, "pro");
  if (!planCheck.ok) {
    res.status(planCheck.status).json(planCheck.body);
    return false;
  }
  return true;
}

router.get("/subscriptions", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/email/subscriptions?brandId=main-street-nutrition",
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
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }

    const subscriptions = await adapter.listEmailSubscriptions(
      userId,
      brandId,
      parseLimit(req.query.limit, 100),
    );
    return res.json(subscriptions);
  } catch (error) {
    return next(error);
  }
});

router.post("/subscriptions", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/email/subscriptions?brandId=main-street-nutrition",
    });
  }

  const parsedBody = emailSubscriptionUpsertSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid email subscription payload",
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
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }

    const subscription = await adapter.upsertEmailSubscription(userId, brandId, parsedBody.data);
    return res.status(201).json(subscription);
  } catch (error) {
    return next(error);
  }
});

router.put("/subscriptions/:id", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/email/subscriptions/:id?brandId=main-street-nutrition",
    });
  }
  const subscriptionId = req.params.id?.trim();
  if (!subscriptionId) {
    return res.status(400).json({ error: "Missing subscription id route parameter" });
  }

  const parsedBody = emailSubscriptionUpdateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid email subscription update payload",
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
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }

    const updated = await adapter.updateEmailSubscription(
      userId,
      brandId,
      subscriptionId,
      parsedBody.data,
    );
    if (!updated) {
      return res.status(404).json({ error: `Email subscription '${subscriptionId}' was not found` });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete("/subscriptions/:id", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/email/subscriptions/:id?brandId=main-street-nutrition",
    });
  }
  const subscriptionId = req.params.id?.trim();
  if (!subscriptionId) {
    return res.status(400).json({ error: "Missing subscription id route parameter" });
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
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }

    const deleted = await adapter.deleteEmailSubscription(userId, brandId, subscriptionId);
    if (!deleted) {
      return res.status(404).json({ error: `Email subscription '${subscriptionId}' was not found` });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/digest/preview", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /api/email/digest/preview?brandId=main-street-nutrition",
    });
  }

  const parsedBody = emailDigestPreviewRequestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid digest preview payload",
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
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }

    const preview = await buildDigestPreview(userId, brandId, {
      cadence: req.query.cadence === "daily" ? "daily" : "weekly",
      rangeDays: parsedBody.data.rangeDays,
      includeNextWeekPlan: parsedBody.data.includeNextWeekPlan,
      notes: parsedBody.data.notes,
    });
    return res.json({
      subject: preview.subject,
      html: preview.html,
      textSummary: preview.textSummary,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/digest/send", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /api/email/digest/send?brandId=main-street-nutrition",
    });
  }

  const parsedBody = emailDigestSendRequestSchema.safeParse({
    ...req.body,
    toEmail:
      typeof (req.body as Record<string, unknown> | undefined)?.toEmail === "string"
        ? (req.body as Record<string, unknown>).toEmail
        : typeof (req.body as Record<string, unknown> | undefined)?.to === "string"
          ? (req.body as Record<string, unknown>).to
          : undefined,
  });
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
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }

    const subscriptions = await adapter.listEmailSubscriptions(userId, brandId, 500);
    const enabledSubscriptions = subscriptions.filter((entry) => entry.enabled);
    const recipients =
      parsedBody.data.toEmail !== undefined
        ? [
            {
              toEmail: parsedBody.data.toEmail.trim().toLowerCase(),
              cadence:
                enabledSubscriptions.find(
                  (entry) =>
                    entry.toEmail.toLowerCase() === parsedBody.data.toEmail!.trim().toLowerCase(),
                )?.cadence ?? "weekly",
              subscriptionId: enabledSubscriptions.find(
                (entry) =>
                  entry.toEmail.toLowerCase() === parsedBody.data.toEmail!.trim().toLowerCase(),
              )?.id,
            },
          ]
        : enabledSubscriptions.map((entry) => ({
            toEmail: entry.toEmail,
            cadence: entry.cadence,
            subscriptionId: entry.id,
          }));

    if (recipients.length === 0) {
      const fallbackTo = process.env.DEFAULT_DIGEST_TO?.trim().toLowerCase();
      if (!fallbackTo) {
        return res.status(400).json({
          error:
            "No enabled subscriptions found. Provide toEmail in request or add an enabled subscription first.",
        });
      }
      recipients.push({
        toEmail: fallbackTo,
        cadence: "weekly",
        subscriptionId: undefined,
      });
    }

    const queued = await Promise.all(
      recipients.map(async (recipient) => {
        const preview = await buildDigestPreview(userId, brandId, {
          cadence: recipient.cadence,
          rangeDays: parsedBody.data.rangeDays ?? 14,
          includeNextWeekPlan: parsedBody.data.includeNextWeekPlan ?? true,
          notes: parsedBody.data.notes,
        });

        const log = await adapter.addEmailLog(userId, brandId, {
          toEmail: recipient.toEmail,
          subject: preview.subject,
          status: "queued",
          subscriptionId: recipient.subscriptionId,
        });

        const outbox = await adapter.enqueueOutbox(
          userId,
          brandId,
          "email_send",
          {
            toEmail: recipient.toEmail,
            subject: preview.subject,
            html: preview.html,
            textSummary: preview.textSummary,
            cadence: recipient.cadence,
            emailLogId: log.id,
            subscriptionId: recipient.subscriptionId,
          },
          new Date().toISOString(),
        );

        return {
          toEmail: recipient.toEmail,
          cadence: recipient.cadence,
          outboxId: outbox.id,
          emailLogId: log.id,
        };
      }),
    );

    return res.status(202).json({
      queued: queued.length,
      items: queued,
      warning: "Digest emails are queued in outbox and sent by the cron outbox processor.",
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/log", async (req, res, next) => {
  const brandId = parseBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error: "Missing or invalid brandId query parameter. Example: /api/email/log?brandId=main-street-nutrition",
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
    if (!(await enforceEmailProAccess(req, res, userId, brandId))) {
      return;
    }
    const logs = await adapter.listEmailLogs(userId, brandId, parseLimit(req.query.limit, 100));
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
});

export default router;
