import { Router } from "express";
import { listDueTownMicroRouteTargets, recomputeTownMicroRoutesForTown } from "../services/townMicroRoutesService";

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

async function processTownMicroRoutes(): Promise<{
  due: number;
  processed: number;
  failed: number;
  updatedRows: number;
}> {
  const targets = await listDueTownMicroRouteTargets(30);
  let processed = 0;
  let failed = 0;
  let updatedRows = 0;
  for (const target of targets) {
    try {
      const result = await recomputeTownMicroRoutesForTown({
        townId: target.townId,
        userId: target.userId,
      });
      processed += 1;
      updatedRows += result.updated;
    } catch {
      failed += 1;
    }
  }
  return {
    due: targets.length,
    processed,
    failed,
    updatedRows,
  };
}

async function handler(reqSecret: string | undefined) {
  if (!isAuthorized(reqSecret)) {
    return {
      status: 401,
      body: { error: "Unauthorized cron request" },
    };
  }
  const result = await processTownMicroRoutes();
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
