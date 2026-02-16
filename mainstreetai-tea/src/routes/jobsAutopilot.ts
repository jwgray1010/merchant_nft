import { Router } from "express";
import { runAutopilotForBrand } from "../services/autopilotService";
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

async function processDueAutopilot(): Promise<{
  due: number;
  processed: number;
  skipped: number;
  failed: number;
}> {
  const adapter = getAdapter();
  const dueSettings = await adapter.listDueAutopilotSettings(new Date().toISOString(), 20);
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const settings of dueSettings) {
    try {
      await runAutopilotForBrand({
        userId: settings.ownerId,
        brandId: settings.brandId,
        source: "cron",
        request: {},
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("already ran")) {
        skipped += 1;
        continue;
      }
      if (message.toLowerCase().includes("closed")) {
        skipped += 1;
        continue;
      }
      failed += 1;
    }
  }

  return {
    due: dueSettings.length,
    processed,
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

  const result = await processDueAutopilot();
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
