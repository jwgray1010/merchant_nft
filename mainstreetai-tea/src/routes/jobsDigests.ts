import { Router } from "express";
import { buildDigestPreview } from "../services/digestService";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

function cronSecret(): string {
  return (process.env.CRON_SECRET ?? "").trim();
}

function isAuthorized(reqSecret: string | undefined): boolean {
  const expected = cronSecret();
  if (!expected) {
    return false;
  }
  return reqSecret === expected;
}

async function queueDueDigests(): Promise<{
  checked: number;
  queued: number;
  failed: number;
}> {
  const adapter = getAdapter();
  const due = await adapter.listDueEmailSubscriptions(new Date().toISOString(), 300);

  let queued = 0;
  let failed = 0;
  for (const subscription of due) {
    try {
      const preview = await buildDigestPreview(subscription.ownerId, subscription.brandId, {
        cadence: subscription.cadence,
        rangeDays: 14,
        includeNextWeekPlan: true,
        notes: "Automated scheduled digest",
      });
      const log = await adapter.addEmailLog(subscription.ownerId, subscription.brandId, {
        toEmail: subscription.toEmail,
        subject: preview.subject,
        status: "queued",
        subscriptionId: subscription.id,
      });

      await adapter.enqueueOutbox(
        subscription.ownerId,
        subscription.brandId,
        "email_send",
        {
          toEmail: subscription.toEmail,
          subject: preview.subject,
          html: preview.html,
          textSummary: preview.textSummary,
          cadence: subscription.cadence,
          emailLogId: log.id,
          subscriptionId: subscription.id,
        },
        new Date().toISOString(),
      );
      queued += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown digest queue error";
      try {
        await adapter.addEmailLog(subscription.ownerId, subscription.brandId, {
          toEmail: subscription.toEmail,
          subject: "Digest generation failed",
          status: "failed",
          error: message.slice(0, 1000),
          subscriptionId: subscription.id,
        });
      } catch {
        // Ignore secondary logging failures to keep cron processing remaining subscriptions.
      }
      failed += 1;
    }
  }

  return {
    checked: due.length,
    queued,
    failed,
  };
}

async function handler(reqSecret: string | undefined) {
  if (!isAuthorized(reqSecret)) {
    return {
      status: 401,
      body: { error: "Unauthorized cron request" },
    };
  }

  const result = await queueDueDigests();
  return {
    status: 200,
    body: {
      ok: true,
      ...result,
    },
  };
}

router.get("/", async (req, res, next) => {
  try {
    const response = await handler(
      typeof req.headers["x-cron-secret"] === "string" ? req.headers["x-cron-secret"] : undefined,
    );
    return res.status(response.status).json(response.body);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const response = await handler(
      typeof req.headers["x-cron-secret"] === "string" ? req.headers["x-cron-secret"] : undefined,
    );
    return res.status(response.status).json(response.body);
  } catch (error) {
    return next(error);
  }
});

export default router;
