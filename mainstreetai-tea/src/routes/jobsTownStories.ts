import { Router } from "express";
import { generateTownStoryForTown, listDueTownStoryTargets } from "../services/townStoriesService";

const router = Router();

function cronSecret(): string {
  return (process.env.CRON_SECRET ?? "").trim();
}

function cadence(): "daily" | "weekly" {
  return (process.env.TOWN_STORY_CADENCE ?? "").trim().toLowerCase() === "weekly" ? "weekly" : "daily";
}

function isAuthorized(reqSecret: string | undefined): boolean {
  const expected = cronSecret();
  if (!expected) {
    return false;
  }
  return reqSecret === expected;
}

async function processTownStories(): Promise<{
  cadence: "daily" | "weekly";
  due: number;
  processed: number;
  failed: number;
}> {
  const activeCadence = cadence();
  const targets = await listDueTownStoryTargets({
    limit: 20,
    cadence: activeCadence,
  });
  let processed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      await generateTownStoryForTown({
        townId: target.townId,
        userId: target.userId,
        storyType: activeCadence === "weekly" ? "weekly" : "daily",
      });
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    cadence: activeCadence,
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
  const result = await processTownStories();
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
