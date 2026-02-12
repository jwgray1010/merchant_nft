import { Router } from "express";
import { listActiveTownPulseTargets, recomputeTownPulseModel } from "../services/townPulseService";

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

async function processTownPulse(): Promise<{
  due: number;
  processed: number;
  failed: number;
}> {
  const targets = await listActiveTownPulseTargets(20);
  let processed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      await recomputeTownPulseModel({
        townId: target.townId,
        userId: target.userId,
        rangeDays: 45,
      });
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    due: targets.length,
    processed,
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
  const result = await processTownPulse();
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
