import { Router, type Request } from "express";
import { buildBrandFromTemplate } from "../data/templateStore";
import { autopilotSettingsUpsertSchema } from "../schemas/autopilotSettingsSchema";
import { brandProfileSchema, brandSupportLevelSchema } from "../schemas/brandSchema";
import { assignSponsoredSeatForBrand } from "../services/communityImpactService";
import { autoAssignTownAmbassadorForBrand } from "../services/townAdoptionService";
import { ensureTownMembershipForBrand, suggestTownFromLocation } from "../services/townModeService";
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

function brandingFromRequest(req: Request): {
  appName: string;
  tagline?: string;
  primaryColor: string;
  logoUrl?: string;
  hideMainstreetaiBranding: boolean;
} {
  return {
    appName: req.tenant?.appName ?? "MainStreetAI",
    tagline: req.tenant?.tagline,
    primaryColor: req.tenant?.primaryColor ?? "#2563eb",
    logoUrl: req.tenant?.logoUrl,
    hideMainstreetaiBranding: req.tenant?.hideMainstreetaiBranding ?? false,
  };
}

function layout(
  title: string,
  body: string,
  branding: {
    appName: string;
    tagline?: string;
    primaryColor: string;
    logoUrl?: string;
    hideMainstreetaiBranding: boolean;
  },
): string {
  const brandLabel = branding.hideMainstreetaiBranding
    ? branding.appName
    : `${branding.appName} by MainStreetAI`;
  const logoHtml = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(
        branding.appName,
      )}" style="height:32px;max-width:200px;object-fit:contain;" />`
    : `<strong style="font-size:18px;">${escapeHtml(branding.appName)}</strong>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)} · ${escapeHtml(branding.appName)}</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
      .hero { background: #0f172a; color: #fff; border-radius: 12px; padding: 26px; margin-bottom: 20px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 14px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
      .button { display: inline-block; padding: 9px 13px; border-radius: 8px; text-decoration: none; border: 1px solid ${escapeHtml(
        branding.primaryColor,
      )}; background: ${escapeHtml(branding.primaryColor)}; color: #fff; }
      .button.secondary { background: #fff; color: #1e293b; border-color: #cbd5e1; }
      input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; }
      textarea { min-height: 80px; }
      .muted { color: #64748b; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px;">
        <div>${logoHtml}</div>
        <div class="muted">${escapeHtml(brandLabel)}</div>
      </div>
      <div style="margin-bottom:16px;">
        <a class="button secondary" href="/app">Easy Mode</a>
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

router.get("/", async (_req, res) => {
  const token = extractAuthToken(_req);
  if (token) {
    const user = await resolveAuthUser(token);
    if (user) {
      return res.redirect("/app");
    }
  }
  const branding = brandingFromRequest(_req);
  const html = layout(
    "AI Growth Engine for Local Businesses",
    `
      <section class="hero">
        <h1>${escapeHtml(branding.appName)}: AI Growth Engine for Local Businesses</h1>
        <p>${
          branding.tagline
            ? escapeHtml(branding.tagline)
            : "Generate tomorrow-ready promos, posts, signs, alerts, and follow-up actions in one place."
        }</p>
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
    branding,
  );
  return res.type("html").send(html);
});

router.get("/pricing", (_req, res) => {
  const branding = brandingFromRequest(_req);
  const html = layout(
    "Pricing",
    `
      <div class="card">
        <h1>Community-first pricing</h1>
        <p class="muted">Built so free access is genuinely useful, while paid plans keep the platform sustainable.</p>
      </div>
      <div class="grid">
        <div class="card">
          <h2>Free (Community Access)</h2>
          <p>Everyday essentials for local businesses.</p>
          <ul><li>One-button Daily Pack</li><li>Town Mode + Local Boost</li><li>Post Now + learning loop</li></ul>
        </div>
        <div class="card">
          <h2>Starter (Owner Growth)</h2>
          <p>Practical tools to improve consistency.</p>
          <ul><li>Timing model + media analysis</li><li>Scheduling</li><li>Enhanced Town Pulse + Automatic Help</li></ul>
        </div>
        <div class="card">
          <h2>Pro (Power Users)</h2>
          <p>Full automation + multi-channel operations.</p>
          <ul><li>SMS campaigns + GBP posting</li><li>Multi-location workflows</li><li>Advanced voice profile tools</li></ul>
        </div>
      </div>
      <div class="card">
        <h2>Community sponsorship</h2>
        <p class="muted">Local banks, chambers, and economic groups can sponsor Starter access for businesses in need.</p>
      </div>
      <div class="card"><a class="button" href="/onboarding">Start Free</a></div>
    `,
    branding,
  );
  return res.type("html").send(html);
});

router.get("/demo", (_req, res) => {
  const branding = brandingFromRequest(_req);
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
    branding,
  );
  return res.type("html").send(html);
});

router.get("/onboarding", (_req, res) => {
  const branding = brandingFromRequest(_req);
  const html = layout(
    "Onboarding Wizard",
    `
      <div class="card">
        <h1>Quick Setup (6 steps)</h1>
        <p class="muted">Simple and fast. You can change details later in Settings.</p>
      </div>
      <form method="POST" action="/onboarding/complete" class="card">
        <h2>Step 1: Business name</h2>
        <div class="grid">
          <div><label>Business Name</label><input name="businessName" required /></div>
          <div><label>Location</label><input name="location" placeholder="Independence, KS" required /></div>
          <div><label>Town</label><input name="townName" placeholder="Independence KS" required /></div>
        </div>

        <h2>Step 2: What do you sell?</h2>
        <div class="grid">
          <div><label>Business Type</label>
            <select name="businessType">
              <option value="cafe">cafe</option>
              <option value="restaurant">restaurant</option>
              <option value="retail">retail</option>
              <option value="salon">salon</option>
              <option value="barber">barber</option>
              <option value="gym">gym</option>
              <option value="auto">auto</option>
              <option value="service">service</option>
              <option value="loaded-tea">loaded-tea</option>
            </select>
          </div>
        </div>

        <h2>Step 3: Who comes in most?</h2>
        <div class="grid">
          <div>
            <label>Main audience</label>
            <select name="topAudience">
              <option value="teachers">teachers</option>
              <option value="gym">gym</option>
              <option value="families">families</option>
              <option value="parents">parents</option>
              <option value="students">students</option>
              <option value="general">general</option>
            </select>
          </div>
        </div>

        <h2>Step 4: How should your business feel?</h2>
        <div class="grid">
          <div>
            <label>Community style</label>
            <select name="communityFeel">
              <option value="down-to-earth">Down-to-earth</option>
              <option value="high-energy-local">High energy local</option>
              <option value="laid-back-hometown">Laid back hometown</option>
              <option value="professional-local">Professional local</option>
            </select>
          </div>
        </div>

        <h2>Step 5: What describes your situation right now?</h2>
        <div class="grid">
          <div>
            <label>Current situation (optional)</label>
            <select name="supportLevel">
              <option value="steady">Steady</option>
              <option value="growing_fast">Growing fast</option>
              <option value="struggling">Struggling to get traffic</option>
              <option value="just_starting">Just starting</option>
            </select>
          </div>
        </div>

        <h2>Step 6: Final setup options</h2>
        <label><input type="checkbox" name="connectSocials" /> Remind me to connect Buffer/GBP after setup</label>
        <br/>
        <label><input type="checkbox" name="enableAutopilot" /> Yes, turn on Automatic Help</label>

        <div style="margin-top:14px;"><button class="button" type="submit">Complete Setup</button></div>
      </form>
    `,
    branding,
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
    const townName = String(body.townName ?? "").trim();
    const businessType = String(body.businessType ?? body.template ?? "service").trim().toLowerCase();
    const templateMap: Record<string, "loaded-tea" | "cafe" | "service" | "retail" | "restaurant" | "gym"> = {
      "loaded-tea": "loaded-tea",
      cafe: "cafe",
      restaurant: "restaurant",
      retail: "retail",
      service: "service",
      salon: "service",
      barber: "service",
      auto: "service",
      gym: "gym",
      fitness: "gym",
    };
    const template = templateMap[businessType] ?? "service";
    const topAudience = String(body.topAudience ?? "").trim();
    const communityFeel = String(body.communityFeel ?? "down-to-earth").trim().toLowerCase();
    const supportLevelRaw = String(body.supportLevel ?? "steady").trim().toLowerCase();
    const supportLevel = brandSupportLevelSchema.safeParse(supportLevelRaw);
    if (!businessName || !location) {
      return res
        .status(400)
        .type("html")
        .send(layout("Onboarding", "<h1>Missing required fields.</h1>", brandingFromRequest(req)));
    }

    const brandId = slugify(`${businessName}-${location}`) || slugify(businessName) || "new-brand";
    const baseBrand = await buildBrandFromTemplate({
      brandId,
      businessName,
      location,
      template,
    });

    const audiences = topAudience ? [topAudience, ...baseBrand.audiences].slice(0, 6) : baseBrand.audiences;
    const offers = baseBrand.offersWeCanUse;
    const voice = baseBrand.voice;
    const localToneMap: Record<
      string,
      "neighborly" | "bold-local" | "supportive" | "hometown-pride"
    > = {
      "down-to-earth": "neighborly",
      "high-energy-local": "bold-local",
      "laid-back-hometown": "hometown-pride",
      "professional-local": "supportive",
    };
    const localTone = localToneMap[communityFeel] ?? "neighborly";
    const audienceStyle: "everyone" | "young-professionals" | "fitness" | "blue-collar" | "creative" | "mixed" =
      topAudience === "gym"
        ? "fitness"
        : topAudience === "students"
          ? "young-professionals"
          : topAudience === "general"
            ? "mixed"
            : "everyone";
    const localIdentityTags = [location, "Local Owned"].filter(Boolean);
    const normalizedTownName = townName || suggestTownFromLocation(location);

    const brand = brandProfileSchema.parse({
      ...baseBrand,
      voice,
      audiences,
      supportLevel: supportLevel.success ? supportLevel.data : "steady",
      offersWeCanUse: offers,
      communityVibeProfile: {
        localTone,
        collaborationLevel: "medium",
        localIdentityTags,
        audienceStyle,
        avoidCorporateTone: true,
      },
    });

    const adapter = getAdapter();
    const created = await adapter.createBrand(user.id, brand);
    if (!created) {
      await adapter.updateBrand(user.id, brand.brandId, brand);
    }
    if (normalizedTownName) {
      await ensureTownMembershipForBrand({
        userId: user.id,
        brandId: brand.brandId,
        townName: normalizedTownName,
        timezone: "America/Chicago",
        participationLevel: "standard",
      });
      await autoAssignTownAmbassadorForBrand({
        ownerId: user.id,
        brandId: brand.brandId,
      }).catch(() => null);
    }

    if (brand.supportLevel === "struggling") {
      await assignSponsoredSeatForBrand({
        ownerId: user.id,
        brandId: brand.brandId,
      }).catch(() => null);
    }

    if (body.enableAutopilot === "on" || body.enableAutopilot === "true") {
      const autopilot = autopilotSettingsUpsertSchema.parse({
        enabled: true,
        cadence: "daily",
        hour: 7,
        timezone: "America/Chicago",
        goals:
          brand.supportLevel === "struggling"
            ? ["slow_hours", "repeat_customers"]
            : ["repeat_customers", "slow_hours"],
        channels: ["facebook", "instagram"],
      });
      await adapter.upsertAutopilotSettings(user.id, brand.brandId, autopilot);
    }

    return res.redirect(`/app?brandId=${encodeURIComponent(brand.brandId)}`);
  } catch (error) {
    return next(error);
  }
});

export default router;
