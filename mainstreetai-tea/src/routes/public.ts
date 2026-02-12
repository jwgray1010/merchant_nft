import { Router } from "express";
import { buildBrandFromTemplate } from "../data/templateStore";
import { autopilotSettingsUpsertSchema } from "../schemas/autopilotSettingsSchema";
import { brandProfileSchema } from "../schemas/brandSchema";
import { getAdapter } from "../storage/getAdapter";
import { extractAuthToken, resolveAuthUser } from "../supabase/verifyAuth";

const router = Router();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)} · MainStreetAI</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
      .hero { background: #0f172a; color: #fff; border-radius: 12px; padding: 26px; margin-bottom: 20px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 14px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
      .button { display: inline-block; padding: 9px 13px; border-radius: 8px; text-decoration: none; border: 1px solid #2563eb; background: #2563eb; color: #fff; }
      .button.secondary { background: #fff; color: #1e293b; border-color: #cbd5e1; }
      input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; }
      textarea { min-height: 80px; }
      .muted { color: #64748b; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div style="margin-bottom:16px;">
        <a class="button secondary" href="/">Home</a>
        <a class="button secondary" href="/pricing">Pricing</a>
        <a class="button secondary" href="/demo">Demo</a>
        <a class="button secondary" href="/onboarding">Onboarding</a>
        <a class="button secondary" href="/admin/login">Login</a>
      </div>
      ${body}
    </div>
  </body>
</html>`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

router.get("/", (_req, res) => {
  const html = layout(
    "AI Growth Engine for Local Businesses",
    `
      <section class="hero">
        <h1>AI Growth Engine for Local Businesses</h1>
        <p>MainStreetAI generates tomorrow-ready promos, posts, signs, alerts, and follow-up actions in one place.</p>
        <a class="button" href="/onboarding">Start Free</a>
      </section>
      <div class="grid">
        <div class="card"><h3>How it works</h3><p>Connect your brand, generate content, schedule, and run autopilot daily.</p></div>
        <div class="card"><h3>Performance loops</h3><p>Track metrics, learn top hooks/offers/times, and continuously improve.</p></div>
        <div class="card"><h3>Operator mode</h3><p>Outbox + cron safely queue publishing, alerts, and owner notifications.</p></div>
      </div>
      <div class="card">
        <h2>What you get</h2>
        <ul>
          <li>Daily ready-to-post assets (promo, social, sign, SMS, GBP)</li>
          <li>Autopilot + anomaly detection + rescue actions</li>
          <li>Scheduling, reminders, and admin workflows for local teams</li>
        </ul>
      </div>
    `,
  );
  return res.type("html").send(html);
});

router.get("/pricing", (_req, res) => {
  const html = layout(
    "Pricing",
    `
      <div class="card">
        <h1>Simple pricing</h1>
        <p class="muted">Use free trial to onboard, then pick a plan that matches your growth workflow.</p>
      </div>
      <div class="grid">
        <div class="card">
          <h2>Starter</h2>
          <p>Manual generation + planning + scheduling essentials.</p>
          <ul><li>Generate content and plans</li><li>History, posts, metrics, insights</li><li>Schedule + ICS export</li></ul>
        </div>
        <div class="card">
          <h2>Pro</h2>
          <p>Autopilot and operator automation.</p>
          <ul><li>Autopilot Growth Engine</li><li>SMS, GBP, email digests</li><li>Anomaly alerts and rescue actions</li></ul>
        </div>
      </div>
      <div class="card"><a class="button" href="/onboarding">Start Free</a></div>
    `,
  );
  return res.type("html").send(html);
});

router.get("/demo", (_req, res) => {
  const sample = {
    promo: { promoName: "Teacher Recharge Hour", offer: "$1 off add-on", timeWindow: "2pm-4pm" },
    post: { platform: "instagram", hook: "After-school fuel is ready.", caption: "Teachers + parents, swing by 2-4!" },
    alert: { type: "low_engagement", action: "Refresh hook style and post at 3:30pm." },
  };
  const html = layout(
    "Demo",
    `
      <div class="card">
        <h1>Demo mode</h1>
        <p class="muted">Read-only preview. Write operations are blocked when demo mode is active.</p>
        <pre>${escapeHtml(JSON.stringify(sample, null, 2))}</pre>
      </div>
    `,
  );
  return res.type("html").send(html);
});

router.get("/onboarding", (_req, res) => {
  const html = layout(
    "Onboarding Wizard",
    `
      <div class="card">
        <h1>Onboarding Wizard</h1>
        <p class="muted">Set up your business in minutes. You can refine everything later in Admin.</p>
      </div>
      <form method="POST" action="/onboarding/complete" class="card">
        <h2>Step 1 — Business</h2>
        <div class="grid">
          <div><label>Business Name</label><input name="businessName" required /></div>
          <div><label>Location</label><input name="location" required /></div>
          <div><label>Template</label>
            <select name="template">
              <option value="loaded-tea">loaded-tea</option>
              <option value="cafe">cafe</option>
              <option value="retail">retail</option>
              <option value="service">service</option>
              <option value="gym">gym</option>
            </select>
          </div>
        </div>

        <h2>Step 2 — Voice + Audience</h2>
        <div><label>Voice</label><textarea name="voice">Friendly, local, practical, and human.</textarea></div>
        <div><label>Audiences (comma-separated)</label><input name="audiences" placeholder="teachers, parents, students" /></div>
        <div><label>Offers allowed (comma-separated)</label><input name="offersWeCanUse" placeholder="$1 off add-on, combo upgrade" /></div>

        <h2>Step 3 — Integrations</h2>
        <p class="muted">You can connect Buffer / GBP / Email in Admin after setup.</p>

        <h2>Step 4 — Autopilot</h2>
        <label><input type="checkbox" name="enableAutopilot" /> Enable Autopilot now</label>

        <div style="margin-top:14px;"><button class="button" type="submit">Complete Setup</button></div>
      </form>
    `,
  );
  return res.type("html").send(html);
});

router.post("/onboarding/complete", async (req, res, next) => {
  try {
    const token = extractAuthToken(req);
    if (!token) {
      return res.redirect("/admin/login");
    }
    const user = await resolveAuthUser(token);
    if (!user) {
      return res.redirect("/admin/login");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const businessName = String(body.businessName ?? "").trim();
    const location = String(body.location ?? "").trim();
    const template = String(body.template ?? "service").trim().toLowerCase();
    if (!businessName || !location) {
      return res.status(400).type("html").send(layout("Onboarding", "<h1>Missing required fields.</h1>"));
    }

    const brandId = slugify(`${businessName}-${location}`) || slugify(businessName) || "new-brand";
    const baseBrand = await buildBrandFromTemplate({
      brandId,
      businessName,
      location,
      template: template as "loaded-tea" | "cafe" | "service" | "retail" | "restaurant" | "gym",
    });

    const audiences =
      typeof body.audiences === "string"
        ? body.audiences
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : baseBrand.audiences;
    const offers =
      typeof body.offersWeCanUse === "string"
        ? body.offersWeCanUse
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : baseBrand.offersWeCanUse;
    const voice =
      typeof body.voice === "string" && body.voice.trim() !== "" ? body.voice.trim() : baseBrand.voice;

    const brand = brandProfileSchema.parse({
      ...baseBrand,
      voice,
      audiences,
      offersWeCanUse: offers,
    });

    const adapter = getAdapter();
    const created = await adapter.createBrand(user.id, brand);
    if (!created) {
      await adapter.updateBrand(user.id, brand.brandId, brand);
    }

    if (body.enableAutopilot === "on" || body.enableAutopilot === "true") {
      const autopilot = autopilotSettingsUpsertSchema.parse({
        enabled: true,
        cadence: "daily",
        hour: 7,
        timezone: "America/Chicago",
        goals: ["repeat_customers", "slow_hours"],
        channels: ["facebook", "instagram"],
      });
      await adapter.upsertAutopilotSettings(user.id, brand.brandId, autopilot);
    }

    return res.redirect(`/admin/tomorrow?brandId=${encodeURIComponent(brand.brandId)}`);
  } catch (error) {
    return next(error);
  }
});

export default router;
