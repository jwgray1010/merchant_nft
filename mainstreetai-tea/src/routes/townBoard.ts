import { Router } from "express";
import { z } from "zod";
import { communityEventNeedSchema } from "../schemas/communityEventsSchema";
import { townBoardSourceSchema } from "../schemas/townBoardSchema";
import { resolveTownBySlug, submitTownBoardPostBySlug } from "../services/townBoardService";

const router = Router();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSource(raw: unknown): z.infer<typeof townBoardSourceSchema> {
  if (typeof raw !== "string") {
    return "organizer";
  }
  const value = raw.trim().toLowerCase();
  if (value === "community" || value === "community_coordinator") {
    return "organizer";
  }
  const parsed = townBoardSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : "organizer";
}

function parseNeeds(raw: unknown): Array<z.infer<typeof communityEventNeedSchema>> {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim() !== ""
      ? [raw]
      : [];
  const needs: Array<z.infer<typeof communityEventNeedSchema>> = [];
  for (const value of values) {
    const parsed = communityEventNeedSchema.safeParse(value);
    if (parsed.success && !needs.includes(parsed.data)) {
      needs.push(parsed.data);
    }
  }
  return needs;
}

function fullTownboardUrl(input: {
  protocol: string;
  host: string;
  townSlug: string;
  source?: z.infer<typeof townBoardSourceSchema>;
}): string {
  const base = `${input.protocol}://${input.host}/townboard/${encodeURIComponent(input.townSlug)}`;
  if (input.source && input.source !== "organizer") {
    return `${base}?source=${encodeURIComponent(input.source)}`;
  }
  return base;
}

function sourceLabel(source: z.infer<typeof townBoardSourceSchema>): string {
  if (source === "school") return "School";
  if (source === "chamber") return "Chamber";
  if (source === "youth") return "Youth Center";
  if (source === "nonprofit") return "Nonprofit";
  return "Community Organizer";
}

function renderTownBoardPage(input: {
  townName: string;
  townSlug: string;
  source: z.infer<typeof townBoardSourceSchema>;
  status?: string;
  error?: string;
}): string {
  const statusHtml = input.status
    ? `<p class="status-ok">${escapeHtml(input.status)}</p>`
    : input.error
      ? `<p class="status-error">${escapeHtml(input.error)}</p>`
      : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(input.townName)} Town Board</title>
    <style>
      :root { color-scheme: light; }
      body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f8f5ef; color:#1f2937; }
      .wrap { max-width: 720px; margin: 0 auto; padding: 18px 16px 32px; }
      .card { background:#fffdf9; border:1px solid #eadfce; border-radius:20px; padding:18px; box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06); }
      h1 { margin:0 0 6px; font-size:28px; line-height:1.15; letter-spacing:-0.01em; }
      h2 { margin:0; font-size:18px; letter-spacing:-0.01em; }
      p { margin:0; }
      .muted { color:#6b7280; margin-top:6px; }
      .pill { display:inline-block; margin-top:10px; padding:7px 10px; border-radius:999px; background:#eef3fb; color:#1f4e79; font-size:13px; font-weight:600; }
      form { margin-top:14px; display:grid; gap:12px; }
      .field { display:grid; gap:6px; }
      label { font-size:14px; color:#334155; }
      input, textarea { width:100%; box-sizing:border-box; border:1px solid #d8cdbd; border-radius:14px; padding:12px 13px; font:inherit; background:#fff; color:#111827; }
      textarea { min-height:92px; resize:vertical; }
      .needs-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; }
      .need-option { display:flex; align-items:center; gap:10px; border:1px solid #d8cdbd; border-radius:16px; padding:12px; background:#fff; min-height:52px; cursor:pointer; }
      .need-option input { width:18px; height:18px; margin:0; }
      .submit { border:0; border-radius:16px; background:#1f4e79; color:#fff; font-size:18px; font-weight:700; padding:14px 16px; min-height:52px; cursor:pointer; }
      .subtle { margin-top:12px; font-size:13px; color:#6b7280; }
      .links { margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; }
      .link-btn { display:inline-flex; align-items:center; justify-content:center; padding:10px 12px; border-radius:12px; border:1px solid #d8cdbd; text-decoration:none; color:#334155; background:#fff; font-weight:600; font-size:14px; }
      .status-ok { margin-top:12px; padding:10px 12px; border-radius:12px; border:1px solid #c6e5cf; background:#eefbf2; color:#14532d; }
      .status-error { margin-top:12px; padding:10px 12px; border-radius:12px; border:1px solid #f3c7c7; background:#fff1f1; color:#7f1d1d; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1>🪧 ${escapeHtml(input.townName)} Town Board</h1>
        <p class="muted">Need help from local businesses? Share your event in one step. No account needed.</p>
        <p class="muted">${escapeHtml(input.townName)} Local Network · Powered by your Chamber</p>
        <span class="pill">Posting as: ${escapeHtml(sourceLabel(input.source))}</span>
        ${statusHtml}
        <form method="POST" action="/townboard/${escapeHtml(encodeURIComponent(input.townSlug))}">
          <input type="hidden" name="source" value="${escapeHtml(input.source)}" />
          <div class="field">
            <label for="eventName">Event Name</label>
            <input id="eventName" name="eventName" required />
          </div>
          <div class="field">
            <label for="date">Date</label>
            <input id="date" name="date" type="datetime-local" required />
          </div>
          <div class="field">
            <label>What help is needed?</label>
            <div class="needs-grid">
              <label class="need-option"><input type="checkbox" name="needs" value="drinks" /> Drinks</label>
              <label class="need-option"><input type="checkbox" name="needs" value="catering" /> Catering</label>
              <label class="need-option"><input type="checkbox" name="needs" value="sponsorship" /> Sponsorship</label>
              <label class="need-option"><input type="checkbox" name="needs" value="volunteers" /> Volunteers</label>
            </div>
          </div>
          <div class="field">
            <label for="description">Short description</label>
            <textarea id="description" name="description" placeholder="A few details owners should know..."></textarea>
          </div>
          <div class="field">
            <label for="contactInfo">Contact info</label>
            <input id="contactInfo" name="contactInfo" required placeholder="Name and phone/email" />
          </div>
          <div class="field">
            <label for="signupUrl">Optional signup link</label>
            <input id="signupUrl" name="signupUrl" type="url" placeholder="https://..." />
          </div>
          <button type="submit" class="submit">Share with Our Town</button>
        </form>
        <p class="subtle">We keep this calm and simple: submissions are reviewed, then shared as local opportunities inside today's plan.</p>
        <div class="links">
          <a class="link-btn" href="/townboard/${escapeHtml(encodeURIComponent(input.townSlug))}/poster?source=${escapeHtml(encodeURIComponent(input.source))}" target="_blank" rel="noopener">Open QR Poster</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

router.get("/townboard/:townSlug", async (req, res) => {
  const townSlug = String(req.params.townSlug ?? "");
  const source = normalizeSource(req.query.source);
  const town = await resolveTownBySlug(townSlug);
  if (!town) {
    return res.status(404).type("html").send(
      `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f8f5ef;">
        <h2>Town board not found</h2>
        <p>This town link is not active yet. Ask your local Main Street organizer for the right townboard link.</p>
      </body></html>`,
    );
  }
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  return res.type("html").send(
    renderTownBoardPage({
      townName: town.region ? `${town.name}, ${town.region}` : town.name,
      townSlug,
      source,
      status,
      error,
    }),
  );
});

router.post("/townboard/:townSlug", async (req, res) => {
  const townSlug = String(req.params.townSlug ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const source = normalizeSource(body.source);
  try {
    const result = await submitTownBoardPostBySlug({
      townSlug,
      source,
      eventName: String(body.eventName ?? ""),
      date: String(body.date ?? ""),
      needs: parseNeeds(body.needs),
      description: typeof body.description === "string" ? body.description : undefined,
      contactInfo: String(body.contactInfo ?? ""),
      signupUrl: typeof body.signupUrl === "string" ? body.signupUrl.trim() || undefined : undefined,
    });
    const acceptHeader = req.headers.accept ?? "";
    if (acceptHeader.includes("text/html")) {
      const encoded = encodeURIComponent("Thanks! Your event is in the queue for local review.");
      return res.redirect(`/townboard/${encodeURIComponent(townSlug)}?source=${encodeURIComponent(source)}&status=${encoded}`);
    }
    return res.status(201).json({
      ok: true,
      status: "pending",
      town: {
        id: result.town.id,
        name: result.town.name,
      },
      post: result.post,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit town board post";
    const acceptHeader = req.headers.accept ?? "";
    if (acceptHeader.includes("text/html")) {
      const encoded = encodeURIComponent(message);
      return res.redirect(`/townboard/${encodeURIComponent(townSlug)}?source=${encodeURIComponent(source)}&error=${encoded}`);
    }
    return res.status(400).json({ error: message });
  }
});

router.get("/townboard/:townSlug/poster", async (req, res) => {
  const townSlug = String(req.params.townSlug ?? "");
  const source = normalizeSource(req.query.source);
  const town = await resolveTownBySlug(townSlug);
  if (!town) {
    return res.status(404).type("html").send("<h2>Town board poster not found.</h2>");
  }
  const boardUrl = fullTownboardUrl({
    protocol: req.protocol,
    host: req.get("host") ?? "localhost:3001",
    townSlug,
    source,
  });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(boardUrl)}`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(town.name)} Town Board Poster</title>
    <style>
      body { margin:0; padding:24px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f8f5ef; color:#111827; }
      .poster { max-width:760px; margin:0 auto; background:#fffdf9; border:2px solid #e2d7c8; border-radius:22px; padding:26px; text-align:center; }
      .badge { display:inline-block; padding:8px 12px; border-radius:999px; background:#eef3fb; color:#1f4e79; font-size:14px; font-weight:700; }
      h1 { font-size:38px; line-height:1.1; margin:16px 0 10px; letter-spacing:-0.02em; }
      p { margin:0; font-size:20px; line-height:1.35; color:#334155; }
      .qr { margin:22px auto 16px; width:320px; height:320px; border-radius:16px; background:#fff; border:1px solid #e5e7eb; display:block; }
      .tiny { margin-top:12px; font-size:13px; color:#6b7280; word-break:break-all; }
      .town { margin-top:8px; font-size:16px; color:#475569; }
      @media print {
        body { background:#fff; padding:0; }
        .poster { border:0; border-radius:0; max-width:none; min-height:100vh; }
      }
    </style>
  </head>
  <body>
    <main class="poster">
      <span class="badge">🪧 ${escapeHtml(town.name)} Town Board</span>
      <h1>Need help from local businesses?<br/>Scan and share your event.</h1>
      <p>One simple form. No account needed.</p>
      <div class="town">${escapeHtml(sourceLabel(source))} access link</div>
      <img class="qr" src="${escapeHtml(qrUrl)}" alt="QR code for town board submission" />
      <p class="tiny">${escapeHtml(boardUrl)}</p>
    </main>
  </body>
</html>`;
  return res.type("html").send(html);
});

export default router;
