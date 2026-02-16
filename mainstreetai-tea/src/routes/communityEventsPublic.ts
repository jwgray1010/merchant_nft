import { Router } from "express";
import {
  communityEventFormSubmitSchema,
  communityEventSourceSchema,
  communityEventsImportRequestSchema,
  type CommunityEventSource,
} from "../schemas/communityEventsSchema";
import { importCommunityEvents, submitCommunityEventForm } from "../services/communityEventsService";

const router = Router();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSourceInput(raw: unknown): CommunityEventSource | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const lower = raw.trim().toLowerCase();
  if (lower === "community coordinator" || lower === "community_coordinator" || lower === "community") {
    return "nonprofit";
  }
  const parsed = communityEventSourceSchema.safeParse(lower);
  return parsed.success ? parsed.data : undefined;
}

router.get("/form", (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Community Event Request</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      .wrap { max-width: 640px; margin: 0 auto; padding: 20px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
      label { display: grid; gap: 6px; margin-top: 10px; font-size: 14px; color: #334155; }
      input, select, textarea { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font: inherit; }
      textarea { min-height: 86px; resize: vertical; }
      button { margin-top: 12px; border: 0; border-radius: 8px; background: #1f4e79; color: #fff; padding: 10px 14px; font-weight: 600; cursor: pointer; }
      .muted { color: #64748b; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Community Event Request</h1>
        <p class="muted">Simple request form for chamber, schools, youth centers, and nonprofits.</p>
        <form method="POST" action="/api/events/submit">
          <label>Town ID
            <input name="townId" required />
          </label>
          <label>Source
            <select name="source">
              <option value="chamber">chamber</option>
              <option value="school">school</option>
              <option value="youth">youth</option>
              <option value="nonprofit">nonprofit</option>
            </select>
          </label>
          <label>Event Name
            <input name="eventName" required />
          </label>
          <label>Date
            <input name="date" placeholder="2026-02-20 18:00" required />
          </label>
          <label>What help is needed?
            <textarea name="helpNeeded" placeholder="Drinks, snacks, volunteers, sponsorship..." required></textarea>
          </label>
          <label>Contact info
            <input name="contactInfo" placeholder="name + email/phone" required />
          </label>
          <label>Signup URL (optional)
            <input name="signupUrl" placeholder="https://..." />
          </label>
          <button type="submit">Submit Request</button>
        </form>
      </div>
    </div>
  </body>
</html>`;
  return res.type("html").send(html);
});

router.post("/import", async (req, res, next) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = communityEventsImportRequestSchema.safeParse({
    ...body,
    source: normalizeSourceInput(body.source),
  });
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid event import payload",
      details: parsed.error.flatten(),
    });
  }
  try {
    const imported = await importCommunityEvents({
      townId: parsed.data.townId,
      source: parsed.data.source,
      icsUrl: parsed.data.icsUrl,
      websiteUrl: parsed.data.websiteUrl,
      websiteText: parsed.data.websiteText,
      googleWebhook: parsed.data.googleWebhook,
      events: parsed.data.events,
      defaultSignupUrl: parsed.data.defaultSignupUrl,
    });
    return res.json({
      ok: true,
      importedCount: imported.importedCount,
      skippedCount: imported.skippedCount,
      events: imported.events.slice(0, 40),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/submit", async (req, res, next) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = communityEventFormSubmitSchema.safeParse({
    ...body,
    source: normalizeSourceInput(body.source),
  });
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid event submission payload",
      details: parsed.error.flatten(),
    });
  }
  try {
    const event = await submitCommunityEventForm({
      townId: parsed.data.townId,
      source: parsed.data.source,
      eventName: parsed.data.eventName,
      date: parsed.data.date,
      helpNeeded: parsed.data.helpNeeded,
      contactInfo: parsed.data.contactInfo,
      description: parsed.data.description,
      signupUrl: parsed.data.signupUrl,
    });
    if (req.headers.accept?.includes("text/html")) {
      return res.type("html").send(
        `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:20px;">
          <h2>Thanks! Your event was submitted.</h2>
          <p><strong>${escapeHtml(event.title)}</strong> on ${escapeHtml(event.eventDate)}</p>
          <p><a href="/api/events/form">Submit another</a></p>
        </body></html>`,
      );
    }
    return res.status(201).json({
      ok: true,
      event,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit event";
    return res.status(400).json({ error: message });
  }
});

export default router;

