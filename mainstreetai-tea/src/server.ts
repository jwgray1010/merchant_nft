import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { startJobRunner } from "./jobs/runner";
import { createGenerationHistoryMiddleware } from "./middleware/generationHistory";
import { verifyAuth } from "./supabase/verifyAuth";
import adminRouter from "./routes/admin";
import brandRouter from "./routes/brand";
import bufferOAuthRouter from "./routes/bufferOAuth";
import emailDigestRouter from "./routes/emailDigest";
import eventsRouter from "./routes/events";
import gbpRouter from "./routes/gbp";
import historyRouter from "./routes/history";
import integrationsRouter from "./routes/integrations";
import insightsRouter from "./routes/insights";
import jobsOutboxRouter from "./routes/jobsOutbox";
import localEventsRouter from "./routes/localEvents";
import metricsRouter from "./routes/metrics";
import nextWeekPlanRouter from "./routes/nextWeekPlan";
import outboxRouter from "./routes/outbox";
import postsRouter from "./routes/posts";
import promoRouter from "./routes/promo";
import publishRouter from "./routes/publish";
import scheduleIcsRouter from "./routes/scheduleIcs";
import scheduleRouter from "./routes/schedule";
import signRouter from "./routes/sign";
import smsRouter from "./routes/sms";
import socialRouter from "./routes/social";
import todayRouter from "./routes/today";
import weekPlanRouter from "./routes/weekPlan";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use("/admin", adminRouter);
app.use("/brands", verifyAuth, brandRouter);
app.use("/history", verifyAuth, historyRouter);
app.use("/local-events", verifyAuth, localEventsRouter);
app.use("/posts", verifyAuth, postsRouter);
app.use("/metrics", verifyAuth, metricsRouter);
app.use("/insights", verifyAuth, insightsRouter);
app.use("/integrations", verifyAuth, integrationsRouter);
app.use("/publish", verifyAuth, publishRouter);
app.use("/sms", verifyAuth, smsRouter);
app.use("/gbp", verifyAuth, gbpRouter);
app.use("/email", verifyAuth, emailDigestRouter);
app.use("/outbox", verifyAuth, outboxRouter);
app.use("/schedule.ics", verifyAuth, scheduleIcsRouter);
app.use("/schedule", verifyAuth, scheduleRouter);
app.use("/today", verifyAuth, todayRouter);
app.use("/sign.pdf", verifyAuth, signRouter);
app.use("/promo", verifyAuth, createGenerationHistoryMiddleware("promo"), promoRouter);
app.use("/social", verifyAuth, createGenerationHistoryMiddleware("social"), socialRouter);
app.use("/events", verifyAuth, createGenerationHistoryMiddleware("events"), eventsRouter);
app.use("/week-plan", verifyAuth, createGenerationHistoryMiddleware("week-plan"), weekPlanRouter);
app.use(
  "/next-week-plan",
  verifyAuth,
  createGenerationHistoryMiddleware("next-week-plan"),
  nextWeekPlanRouter,
);

// Next.js-style API aliases for phased workflow compatibility
app.use("/api/integrations/buffer", bufferOAuthRouter);
app.use("/api/integrations", verifyAuth, integrationsRouter);
app.use("/api/publish", verifyAuth, publishRouter);
app.use("/api/posts", verifyAuth, postsRouter);
app.use("/api/history", verifyAuth, historyRouter);
app.use("/api/sms", verifyAuth, smsRouter);
app.use("/api/jobs/outbox", jobsOutboxRouter);

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
