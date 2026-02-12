import { Router } from "express";
import { detectAndQueueAlertsForBrand } from "../services/alertsService";
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

async function runAlertDetection(): Promise<{
  checked: number;
  created: number;
  skipped: number;
  failed: number;
}> {
  const adapter = getAdapter();
  const settings = await adapter.listEnabledAutopilotSettings(80);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of settings) {
    try {
      const result = await detectAndQueueAlertsForBrand({
        userId: entry.ownerId,
        brandId: entry.brandId,
      });
      created += result.created;
      skipped += result.skipped;
    } catch {
      failed += 1;
    }
  }

  return {
    checked: settings.length,
    created,
    skipped,
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
  const result = await runAlertDetection();
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
