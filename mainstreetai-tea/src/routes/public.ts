import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { buildBrandFromTemplate } from "../data/templateStore";
import { isEmailEnabled, isTwilioEnabled } from "../integrations/env";
import { autopilotSettingsUpsertSchema } from "../schemas/autopilotSettingsSchema";
import { brandProfileSchema, brandSupportLevelSchema } from "../schemas/brandSchema";
import { assignSponsoredSeatForBrand } from "../services/communityImpactService";
import {
  autoAssignTownAmbassadorForBrand,
  findTownInviteByCode,
  resolveInviterBrandByRef,
  updateTownInvite,
} from "../services/townAdoptionService";
import { resolveTownBySlug } from "../services/townBoardService";
import { ensureTownMembershipForBrand, suggestTownFromLocation } from "../services/townModeService";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { createSignedSessionToken, extractAuthToken, resolveAuthUser } from "../supabase/verifyAuth";
import { normalizeUSPhone } from "../utils/phone";

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

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3001").trim().replace(/\/+$/, "");
}

type JoinContactPreference = "sms" | "email";

type JoinMagicPayload = {
  v: 1;
  t: "town_join";
  townId: string;
  townSlug: string;
  inviteCode: string;
  businessName: string;
  contactPreference: JoinContactPreference;
  contactValue: string;
  exp: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch (_error) {
    return null;
  }
}

function joinTokenSecret(): string {
  return (
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.INTEGRATION_SECRET_KEY?.trim() ||
    "mainstreetai-join-token-secret"
  );
}

function signJoinToken(payloadSegment: string): string {
  return createHmac("sha256", joinTokenSecret()).update(payloadSegment).digest("base64url");
}

function createJoinMagicToken(input: {
  townId: string;
  townSlug: string;
  inviteCode: string;
  businessName: string;
  contactPreference: JoinContactPreference;
  contactValue: string;
  ttlSeconds?: number;
}): string {
  const ttlSeconds = Math.max(300, Math.min(60 * 60 * 24, input.ttlSeconds ?? 60 * 30));
  const payload: JoinMagicPayload = {
    v: 1,
    t: "town_join",
    townId: input.townId,
    townSlug: input.townSlug,
    inviteCode: input.inviteCode.trim().toUpperCase(),
    businessName: input.businessName.trim(),
    contactPreference: input.contactPreference,
    contactValue: input.contactValue.trim(),
    exp: Date.now() + ttlSeconds * 1000,
  };
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signature = signJoinToken(payloadSegment);
  return `${payloadSegment}.${signature}`;
}

function readJoinMagicToken(token: string): JoinMagicPayload | null {
  const separator = token.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const payloadSegment = token.slice(0, separator);
  const signatureSegment = token.slice(separator + 1);
  if (!payloadSegment || !signatureSegment) {
    return null;
  }
  const expectedSignature = signJoinToken(payloadSegment);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(signatureSegment, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null;
  }
  const decoded = base64UrlDecode(payloadSegment);
  if (!decoded) {
    return null;
  }
  let parsed: JoinMagicPayload;
  try {
    parsed = JSON.parse(decoded) as JoinMagicPayload;
  } catch (_error) {
    return null;
  }
  if (
    parsed?.v !== 1 ||
    parsed?.t !== "town_join" ||
    typeof parsed.townId !== "string" ||
    !parsed.townId ||
    typeof parsed.townSlug !== "string" ||
    !parsed.townSlug ||
    typeof parsed.inviteCode !== "string" ||
    !parsed.inviteCode ||
    typeof parsed.businessName !== "string" ||
    !parsed.businessName ||
    (parsed.contactPreference !== "sms" && parsed.contactPreference !== "email") ||
    typeof parsed.contactValue !== "string" ||
    !parsed.contactValue ||
    typeof parsed.exp !== "number"
  ) {
    return null;
  }
  if (Date.now() > parsed.exp) {
    return null;
  }
  return parsed;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeNormalizePhone(value: string): string | null {
  try {
    return normalizeUSPhone(value);
  } catch (_error) {
    return null;
  }
}

function localUserIdFromContact(preference: JoinContactPreference, value: string): string {
  if (preference === "email") {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "local-owner"
    );
  }
  const digits = value.replace(/\D/g, "");
  return digits ? `sms-${digits.slice(-12)}` : "local-owner";
}

function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  return `msai_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

function templateFromInviteCategory(category: string): "loaded-tea" | "cafe" | "service" | "retail" | "restaurant" | "gym" {
  const normalized = category.trim().toLowerCase();
  if (normalized === "loaded-tea") return "loaded-tea";
  if (normalized === "cafe" || normalized === "coffee") return "cafe";
  if (normalized === "restaurant" || normalized === "food") return "restaurant";
  if (normalized === "retail" || normalized === "shop") return "retail";
  if (normalized === "gym" || normalized === "fitness") return "gym";
  return "service";
}

async function findSupabaseUserByContact(input: {
  preference: JoinContactPreference;
  value: string;
}): Promise<{ id: string; email: string | null } | null> {
  const admin = getSupabaseAdminClient();
  const target = input.value.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }
    const users = data?.users ?? [];
    const matched = users.find((entry) => {
      if (input.preference === "email") {
        return (entry.email ?? "").trim().toLowerCase() === target;
      }
      return (entry.phone ?? "").trim().toLowerCase() === target;
    });
    if (matched) {
      return {
        id: matched.id,
        email: matched.email ?? null,
      };
    }
    if (users.length < perPage) {
      break;
    }
    page += 1;
  }
  return null;
}

async function resolveOrCreateJoinUser(input: {
  preference: JoinContactPreference;
  value: string;
}): Promise<{ id: string; email: string | null }> {
  if (getStorageMode() === "local") {
    const localId = localUserIdFromContact(input.preference, input.value);
    return {
      id: localId,
      email: input.preference === "email" ? input.value.toLowerCase() : null,
    };
  }
  const existing = await findSupabaseUserByContact(input);
  if (existing) {
    return existing;
  }
  const admin = getSupabaseAdminClient();
  const created =
    input.preference === "email"
      ? await admin.auth.admin.createUser({
          email: input.value.toLowerCase(),
          email_confirm: true,
        })
      : await admin.auth.admin.createUser({
          phone: input.value,
          phone_confirm: true,
        });
  if (created.error || !created.data.user?.id) {
    const retry = await findSupabaseUserByContact(input);
    if (retry) {
      return retry;
    }
    throw new Error(created.error?.message ?? "Could not provision account");
  }
  return {
    id: created.data.user.id,
    email: created.data.user.email ?? (input.preference === "email" ? input.value.toLowerCase() : null),
  };
}

async function ensureUniqueBrandId(ownerId: string, desired: string): Promise<string> {
  const adapter = getAdapter();
  const base = slugify(desired) || "local-business";
  const first = await adapter.getBrand(ownerId, base);
  if (!first) {
    return base;
  }
  for (let index = 2; index <= 120; index += 1) {
    const candidate = `${base}-${index}`;
    const existing = await adapter.getBrand(ownerId, candidate);
    if (!existing) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
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

router.get("/join/:townSlug", async (req, res, next) => {
  try {
    const branding = brandingFromRequest(req);
    const townSlug = String(req.params.townSlug ?? "").trim();
    const inviteCode = String(req.query.code ?? "").trim().toUpperCase();
    const town = await resolveTownBySlug(townSlug);
    if (!town) {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Town not found</h1><p class="muted">Please confirm the invite link from your Chamber.</p></div>`,
        branding,
      );
      return res.status(404).type("html").send(html);
    }
    if (!inviteCode) {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Invite code required</h1><p class="muted">This invite link is missing a code.</p></div>`,
        branding,
      );
      return res.status(400).type("html").send(html);
    }
    const invite = await findTownInviteByCode({
      townId: town.id,
      code: inviteCode,
    });
    if (!invite) {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Invite not found</h1><p class="muted">Ask your Chamber for a fresh invite link.</p></div>`,
        branding,
      );
      return res.status(404).type("html").send(html);
    }
    if (invite.status === "declined") {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Invite is no longer active</h1><p class="muted">Ask your Chamber for a new invite code.</p></div>`,
        branding,
      );
      return res.status(400).type("html").send(html);
    }
    const selectedPreference =
      invite.contactPreference === "sms" || invite.contactPreference === "email"
        ? invite.contactPreference
        : "email";
    const prefilledPhone = invite.invitedPhone ?? "";
    const prefilledEmail = invite.invitedEmail ?? "";
    const acceptedNote =
      invite.status === "accepted"
        ? `<p class="muted" style="margin-top:8px;">This invite was already accepted. You can still request a fresh magic link below.</p>`
        : "";
    const formAction = `/join/${encodeURIComponent(townSlug)}?code=${encodeURIComponent(inviteCode)}`;
    const html = layout(
      `${town.name} local network join`,
      `
      <div class="card">
        <h1>${escapeHtml(town.name)} Local Network</h1>
        <p class="muted">Powered by your Chamber</p>
        <p>Start with just one contact method. You can add more details later.</p>
      </div>
      <form method="POST" action="${escapeHtml(formAction)}" class="card">
        <h2>Join in one minute</h2>
        <div class="field">
          <label>Business name</label>
          <input name="businessName" required value="${escapeHtml(invite.invitedBusiness)}" />
        </div>
        <div class="field">
          <label><input type="radio" name="contactPreference" value="sms" ${
            selectedPreference === "sms" ? "checked" : ""
          } /> Phone for text login links</label>
          <input name="phone" type="tel" placeholder="(555) 123-4567" value="${escapeHtml(prefilledPhone)}" />
        </div>
        <div class="field">
          <label><input type="radio" name="contactPreference" value="email" ${
            selectedPreference === "email" ? "checked" : ""
          } /> Email for login links</label>
          <input name="email" type="email" placeholder="owner@example.com" value="${escapeHtml(prefilledEmail)}" />
        </div>
        <button class="button" type="submit">Send my magic link</button>
        ${acceptedNote}
      </form>
      `,
      branding,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/join/:townSlug", async (req, res, next) => {
  try {
    const branding = brandingFromRequest(req);
    const townSlug = String(req.params.townSlug ?? "").trim();
    const inviteCode = String(req.query.code ?? "").trim().toUpperCase();
    const town = await resolveTownBySlug(townSlug);
    if (!town || !inviteCode) {
      return res.status(400).type("html").send(layout("Join local network", "<div class=\"card\"><h1>Invalid invite link.</h1></div>", branding));
    }
    const invite = await findTownInviteByCode({
      townId: town.id,
      code: inviteCode,
    });
    if (!invite) {
      return res
        .status(404)
        .type("html")
        .send(layout("Join local network", "<div class=\"card\"><h1>Invite not found.</h1></div>", branding));
    }
    if (invite.status === "declined") {
      return res
        .status(400)
        .type("html")
        .send(layout("Join local network", "<div class=\"card\"><h1>Invite is no longer active.</h1></div>", branding));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const businessName = String(body.businessName ?? invite.invitedBusiness).trim();
    const contactPreferenceRaw = String(body.contactPreference ?? "").trim().toLowerCase();
    if ((contactPreferenceRaw !== "sms" && contactPreferenceRaw !== "email") || !businessName) {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Missing details</h1><p class="muted">Add your business name and choose phone or email.</p></div>`,
        branding,
      );
      return res.status(400).type("html").send(html);
    }
    const contactPreference = contactPreferenceRaw as JoinContactPreference;
    const rawEmail = String(body.email ?? "").trim().toLowerCase();
    const rawPhone = String(body.phone ?? "").trim();
    const normalizedPhone = rawPhone ? safeNormalizePhone(rawPhone) : null;
    if (contactPreference === "email" && !looksLikeEmail(rawEmail)) {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Valid email required</h1><p class="muted">Please enter a valid email to receive your magic link.</p></div>`,
        branding,
      );
      return res.status(400).type("html").send(html);
    }
    if (contactPreference === "sms" && !normalizedPhone) {
      const html = layout(
        "Join local network",
        `<div class="card"><h1>Valid phone required</h1><p class="muted">Please enter a phone number for text login links.</p></div>`,
        branding,
      );
      return res.status(400).type("html").send(html);
    }
    const contactValue = contactPreference === "email" ? rawEmail : normalizedPhone ?? "";
    const updatedInvite = await updateTownInvite({
      inviteId: invite.id,
      updates: {
        invitedBusiness: businessName,
        contactPreference,
        invitedEmail: contactPreference === "email" ? rawEmail : null,
        invitedPhone: contactPreference === "sms" ? normalizedPhone : null,
        status: "sent",
      },
    });
    const effectiveCode = (updatedInvite?.inviteCode ?? invite.inviteCode ?? inviteCode).trim().toUpperCase();
    const magicToken = createJoinMagicToken({
      townId: town.id,
      townSlug,
      inviteCode: effectiveCode,
      businessName,
      contactPreference,
      contactValue,
    });
    const magicUrl = `${appBaseUrl()}/join/${encodeURIComponent(townSlug)}/magic?token=${encodeURIComponent(magicToken)}`;
    const deliveryText =
      contactPreference === "sms" ? "We sent a text login link." : "We sent an email login link.";
    const deliveryFallbackText = "Your secure magic link is ready.";
    let deliveryStatus = deliveryFallbackText;

    const inviter = await resolveInviterBrandByRef({
      brandRef: invite.invitedByBrandRef,
    }).catch(() => null);
    if (inviter && inviter.status === "active") {
      const adapter = getAdapter();
      const subject = `${town.name} Local Network invite`;
      const plainText = `Open your secure login link:\n${magicUrl}\n\nThis link expires in 30 minutes.`;
      if (contactPreference === "email" && isEmailEnabled() && rawEmail) {
        const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:16px;white-space:pre-wrap;">${escapeHtml(
          plainText,
        ).replace(/\n/g, "<br/>")}</body></html>`;
        const log = await adapter.addEmailLog(inviter.ownerId, inviter.brandId, {
          toEmail: rawEmail,
          subject,
          status: "queued",
        });
        await adapter.enqueueOutbox(
          inviter.ownerId,
          inviter.brandId,
          "email_send",
          {
            toEmail: rawEmail,
            subject,
            html,
            textSummary: plainText,
            emailLogId: log.id,
          },
          new Date().toISOString(),
        );
        deliveryStatus = deliveryText;
      } else if (contactPreference === "sms" && isTwilioEnabled() && normalizedPhone) {
        await adapter.enqueueOutbox(
          inviter.ownerId,
          inviter.brandId,
          "sms_send",
          {
            to: normalizedPhone,
            body: plainText,
            purpose: "join_magic_link",
          },
          new Date().toISOString(),
        );
        deliveryStatus = deliveryText;
      }
    }

    const html = layout(
      `${town.name} local network join`,
      `
      <div class="card">
        <h1>You're almost in</h1>
        <p>${escapeHtml(deliveryStatus)}</p>
        <p class="muted">If your message does not arrive right away, use this secure link:</p>
        <p><a class="button" href="${escapeHtml(magicUrl)}">Open magic link</a></p>
      </div>
      `,
      branding,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/join/:townSlug/magic", async (req, res, next) => {
  try {
    const branding = brandingFromRequest(req);
    const townSlug = String(req.params.townSlug ?? "").trim();
    const town = await resolveTownBySlug(townSlug);
    if (!town) {
      return res
        .status(404)
        .type("html")
        .send(layout("Join local network", "<div class=\"card\"><h1>Town not found.</h1></div>", branding));
    }
    const tokenRaw = String(req.query.token ?? "").trim();
    const payload = readJoinMagicToken(tokenRaw);
    if (!payload || payload.townId !== town.id || slugify(payload.townSlug) !== slugify(townSlug)) {
      return res
        .status(400)
        .type("html")
        .send(layout("Join local network", "<div class=\"card\"><h1>Magic link is invalid or expired.</h1></div>", branding));
    }
    const invite = await findTownInviteByCode({
      townId: town.id,
      code: payload.inviteCode,
    });
    if (!invite) {
      return res
        .status(404)
        .type("html")
        .send(layout("Join local network", "<div class=\"card\"><h1>Invite not found.</h1></div>", branding));
    }
    if (invite.status === "declined") {
      return res
        .status(400)
        .type("html")
        .send(layout("Join local network", "<div class=\"card\"><h1>Invite is no longer active.</h1></div>", branding));
    }

    const user = await resolveOrCreateJoinUser({
      preference: payload.contactPreference,
      value: payload.contactValue,
    });
    const adapter = getAdapter();
    const businessName = payload.businessName.trim() || invite.invitedBusiness;
    const desiredBrandId = slugify(businessName) || "local-business";
    const existing = await adapter.getBrand(user.id, desiredBrandId);
    const brandId = existing ? desiredBrandId : await ensureUniqueBrandId(user.id, desiredBrandId);
    const statusPatch = {
      status: "active" as const,
      statusReason: undefined,
      statusUpdatedAt: new Date().toISOString(),
      statusUpdatedBy: user.id,
      contactPreference: payload.contactPreference,
      contactEmail: payload.contactPreference === "email" ? payload.contactValue.toLowerCase() : undefined,
      contactPhone:
        payload.contactPreference === "sms"
          ? safeNormalizePhone(payload.contactValue) ?? payload.contactValue
          : undefined,
      eventContactPreference: payload.contactPreference,
    };
    let finalBrandId = brandId;
    if (existing) {
      await adapter.updateBrand(user.id, existing.brandId, statusPatch);
      finalBrandId = existing.brandId;
    } else {
      const location = town.region ? `${town.name}, ${town.region}` : town.name;
      const template = templateFromInviteCategory(invite.category);
      const baseBrand = await buildBrandFromTemplate({
        brandId,
        businessName,
        location,
        template,
      });
      const mergedBrand = brandProfileSchema.parse({
        ...baseBrand,
        ...statusPatch,
      });
      const created = await adapter.createBrand(user.id, mergedBrand);
      if (!created) {
        await adapter.updateBrand(user.id, mergedBrand.brandId, mergedBrand);
      }
      finalBrandId = mergedBrand.brandId;
    }
    await ensureTownMembershipForBrand({
      userId: user.id,
      brandId: finalBrandId,
      townName: town.name,
      region: town.region,
      timezone: town.timezone,
      participationLevel: "standard",
    }).catch(() => null);
    await autoAssignTownAmbassadorForBrand({
      ownerId: user.id,
      brandId: finalBrandId,
    }).catch(() => null);
    await updateTownInvite({
      inviteId: invite.id,
      updates: {
        invitedBusiness: businessName,
        contactPreference: payload.contactPreference,
        invitedEmail: payload.contactPreference === "email" ? payload.contactValue.toLowerCase() : null,
        invitedPhone:
          payload.contactPreference === "sms" ? safeNormalizePhone(payload.contactValue) ?? payload.contactValue : null,
        status: "accepted",
      },
    }).catch(() => null);

    const authToken = createSignedSessionToken({
      userId: user.id,
      email: user.email,
      ttlSeconds: 60 * 60 * 24 * 30,
    });
    res.setHeader("Set-Cookie", sessionCookie(authToken));
    return res.redirect(`/app?brandId=${encodeURIComponent(finalBrandId)}`);
  } catch (error) {
    return next(error);
  }
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
