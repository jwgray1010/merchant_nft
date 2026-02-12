import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createGenerationHistoryMiddleware } from "./middleware/generationHistory";
import brandRouter from "./routes/brand";
import eventsRouter from "./routes/events";
import insightsRouter from "./routes/insights";
import metricsRouter from "./routes/metrics";
import nextWeekPlanRouter from "./routes/nextWeekPlan";
import postsRouter from "./routes/posts";
import promoRouter from "./routes/promo";
import socialRouter from "./routes/social";
import weekPlanRouter from "./routes/weekPlan";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use("/brands", brandRouter);
app.use("/posts", postsRouter);
app.use("/metrics", metricsRouter);
app.use("/insights", insightsRouter);
app.use("/promo", createGenerationHistoryMiddleware("promo"), promoRouter);
app.use("/social", createGenerationHistoryMiddleware("social"), socialRouter);
app.use("/events", createGenerationHistoryMiddleware("events"), eventsRouter);
app.use("/week-plan", createGenerationHistoryMiddleware("week-plan"), weekPlanRouter);
app.use(
  "/next-week-plan",
  createGenerationHistoryMiddleware("next-week-plan"),
  nextWeekPlanRouter,
);

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
