import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { resolveBrandAccessFromQuery } from "./auth/brandAccess";
import { startJobRunner } from "./jobs/runner";
import { createGenerationHistoryMiddleware } from "./middleware/generationHistory";
import { demoModeMiddleware } from "./middleware/demoMode";
import { tenantResolver } from "./middleware/tenantResolver";
import { verifyAuth } from "./supabase/verifyAuth";
import adminRouter from "./routes/admin";
import adminIntelligenceRouter from "./routes/adminIntelligence";
import adminSaasRouter from "./routes/adminSaas";
import alertsRouter from "./routes/alerts";
import autopilotRouter from "./routes/autopilot";
import billingRouter from "./routes/billing";
import billingWebhookRouter from "./routes/billingWebhook";
import brandRouter from "./routes/brand";
import bufferOAuthRouter from "./routes/bufferOAuth";
import emailDigestRouter from "./routes/emailDigest";
import easyModeRouter from "./routes/easyMode";
import dailyRouter from "./routes/daily";
import eventsRouter from "./routes/events";
import gbpRouter from "./routes/gbp";
import gbpOAuthRouter from "./routes/gbpOAuth";
import historyRouter from "./routes/history";
import integrationsRouter from "./routes/integrations";
import insightsRouter from "./routes/insights";
import jobsAlertsRouter from "./routes/jobsAlerts";
import jobsAutopilotRouter from "./routes/jobsAutopilot";
import jobsDigestsRouter from "./routes/jobsDigests";
import jobsOutboxRouter from "./routes/jobsOutbox";
import jobsTownGraphRouter from "./routes/jobsTownGraph";
import jobsTownMicroRoutesRouter from "./routes/jobsTownMicroRoutes";
import jobsTownPulseRouter from "./routes/jobsTownPulse";
import jobsTownSeasonsRouter from "./routes/jobsTownSeasons";
import jobsTownStoriesRouter from "./routes/jobsTownStories";
import localCollabRouter from "./routes/localCollab";
import localEventsRouter from "./routes/localEvents";
import locationsRouter from "./routes/locations";
import mediaRouter from "./routes/media";
import metricsRouter from "./routes/metrics";
import nextWeekPlanRouter from "./routes/nextWeekPlan";
import outboxRouter from "./routes/outbox";
import postNowRouter from "./routes/postNow";
import postsRouter from "./routes/posts";
import promoRouter from "./routes/promo";
import publishRouter from "./routes/publish";
import publicRouter from "./routes/public";
import rescueRouter from "./routes/rescue";
import scheduleIcsRouter from "./routes/scheduleIcs";
import scheduleRouter from "./routes/schedule";
import signRouter from "./routes/sign";
import smsRouter from "./routes/sms";
import socialRouter from "./routes/social";
import teamRouter from "./routes/team";
import tenantRouter from "./routes/tenant";
import trustRouter from "./routes/trust";
import townRouter from "./routes/town";
import timingRouter from "./routes/timing";
import todayRouter from "./routes/today";
import voiceRouter from "./routes/voice";
import weekPlanRouter from "./routes/weekPlan";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use("/api/billing/webhook", express.raw({ type: "application/json" }), billingWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(demoModeMiddleware);
app.use(tenantResolver);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use("/admin", adminRouter);
app.use("/admin", adminSaasRouter);
app.use("/admin", adminIntelligenceRouter);
app.use("/brands", verifyAuth, brandRouter);
app.use("/history", verifyAuth, resolveBrandAccessFromQuery(), historyRouter);
app.use("/local-events", verifyAuth, resolveBrandAccessFromQuery(), localEventsRouter);
app.use("/locations", verifyAuth, resolveBrandAccessFromQuery(), locationsRouter);
app.use("/voice", verifyAuth, resolveBrandAccessFromQuery(), voiceRouter);
app.use("/media", verifyAuth, resolveBrandAccessFromQuery(), mediaRouter);
app.use("/timing", verifyAuth, resolveBrandAccessFromQuery(), timingRouter);
app.use("/post-now", verifyAuth, resolveBrandAccessFromQuery(), postNowRouter);
app.use("/posts", verifyAuth, resolveBrandAccessFromQuery(), postsRouter);
app.use("/metrics", verifyAuth, resolveBrandAccessFromQuery(), metricsRouter);
app.use("/insights", verifyAuth, resolveBrandAccessFromQuery(), insightsRouter);
app.use("/alerts", verifyAuth, resolveBrandAccessFromQuery(), alertsRouter);
app.use("/autopilot", verifyAuth, resolveBrandAccessFromQuery(), autopilotRouter);
app.use("/integrations", verifyAuth, resolveBrandAccessFromQuery(), integrationsRouter);
app.use("/publish", verifyAuth, resolveBrandAccessFromQuery(), publishRouter);
app.use("/sms", verifyAuth, resolveBrandAccessFromQuery(), smsRouter);
app.use("/gbp", verifyAuth, resolveBrandAccessFromQuery(), gbpRouter);
app.use("/email", verifyAuth, resolveBrandAccessFromQuery(), emailDigestRouter);
app.use("/outbox", verifyAuth, resolveBrandAccessFromQuery(), outboxRouter);
app.use("/schedule.ics", verifyAuth, resolveBrandAccessFromQuery(), scheduleIcsRouter);
app.use("/schedule", verifyAuth, resolveBrandAccessFromQuery(), scheduleRouter);
app.use("/today", verifyAuth, resolveBrandAccessFromQuery(), todayRouter);
app.use("/sign.pdf", verifyAuth, resolveBrandAccessFromQuery(), signRouter);
app.use("/daily", verifyAuth, resolveBrandAccessFromQuery(), dailyRouter);
app.use("/rescue", verifyAuth, resolveBrandAccessFromQuery(), rescueRouter);
app.use("/local-collab", verifyAuth, resolveBrandAccessFromQuery(), localCollabRouter);
app.use("/trust", verifyAuth, resolveBrandAccessFromQuery(), trustRouter);
app.use("/town", verifyAuth, townRouter);
app.use(
  "/promo",
  verifyAuth,
  resolveBrandAccessFromQuery(),
  createGenerationHistoryMiddleware("promo"),
  promoRouter,
);
app.use(
  "/social",
  verifyAuth,
  resolveBrandAccessFromQuery(),
  createGenerationHistoryMiddleware("social"),
  socialRouter,
);
app.use(
  "/events",
  verifyAuth,
  resolveBrandAccessFromQuery(),
  createGenerationHistoryMiddleware("events"),
  eventsRouter,
);
app.use(
  "/week-plan",
  verifyAuth,
  resolveBrandAccessFromQuery(),
  createGenerationHistoryMiddleware("week-plan"),
  weekPlanRouter,
);
app.use(
  "/next-week-plan",
  verifyAuth,
  resolveBrandAccessFromQuery(),
  createGenerationHistoryMiddleware("next-week-plan"),
  nextWeekPlanRouter,
);

// Next.js-style API aliases for phased workflow compatibility
app.use("/api/integrations/buffer", bufferOAuthRouter);
app.use("/api/integrations/gbp", gbpOAuthRouter);
app.use("/api/billing", verifyAuth, billingRouter);
app.use("/api/integrations", verifyAuth, resolveBrandAccessFromQuery(), integrationsRouter);
app.use("/api/publish", verifyAuth, resolveBrandAccessFromQuery(), publishRouter);
app.use("/api/posts", verifyAuth, resolveBrandAccessFromQuery(), postsRouter);
app.use("/api/history", verifyAuth, resolveBrandAccessFromQuery(), historyRouter);
app.use("/api/sms", verifyAuth, resolveBrandAccessFromQuery(), smsRouter);
app.use("/api/email", verifyAuth, resolveBrandAccessFromQuery(), emailDigestRouter);
app.use("/api/gbp", verifyAuth, resolveBrandAccessFromQuery(), gbpRouter);
app.use("/api/alerts", verifyAuth, resolveBrandAccessFromQuery(), alertsRouter);
app.use("/api/autopilot", verifyAuth, resolveBrandAccessFromQuery(), autopilotRouter);
app.use("/api/team", verifyAuth, resolveBrandAccessFromQuery(), teamRouter);
app.use("/api/locations", verifyAuth, resolveBrandAccessFromQuery(), locationsRouter);
app.use("/api/voice", verifyAuth, resolveBrandAccessFromQuery(), voiceRouter);
app.use("/api/media", verifyAuth, resolveBrandAccessFromQuery(), mediaRouter);
app.use("/api/timing", verifyAuth, resolveBrandAccessFromQuery(), timingRouter);
app.use("/api/post-now", verifyAuth, resolveBrandAccessFromQuery(), postNowRouter);
app.use("/api/daily", verifyAuth, resolveBrandAccessFromQuery(), dailyRouter);
app.use("/api/rescue", verifyAuth, resolveBrandAccessFromQuery(), rescueRouter);
app.use("/api/local-collab", verifyAuth, resolveBrandAccessFromQuery(), localCollabRouter);
app.use("/api/trust", verifyAuth, resolveBrandAccessFromQuery(), trustRouter);
app.use("/api/town", verifyAuth, townRouter);
app.use("/api/tenant", verifyAuth, tenantRouter);
app.use("/api/jobs/outbox", jobsOutboxRouter);
app.use("/api/jobs/digests", jobsDigestsRouter);
app.use("/api/jobs/autopilot", jobsAutopilotRouter);
app.use("/api/jobs/alerts", jobsAlertsRouter);
app.use("/api/jobs/town-pulse", jobsTownPulseRouter);
app.use("/api/jobs/town-stories", jobsTownStoriesRouter);
app.use("/api/jobs/town-graph", jobsTownGraphRouter);
app.use("/api/jobs/town-micro-routes", jobsTownMicroRoutesRouter);
app.use("/api/jobs/town-seasons", jobsTownSeasonsRouter);
app.use("/app", easyModeRouter);
app.use("/", publicRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Request failed: ${message}`);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`MainStreetAI API listening on port ${port}`);
});

startJobRunner();
