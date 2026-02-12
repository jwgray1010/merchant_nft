import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  getTwilioProvider,
} from "../integrations/providerFactory";
import {
  isBufferEnabled,
  isEmailEnabled,
  isGoogleBusinessEnabled,
  isTwilioEnabled,
} from "../integrations/env";
import { AVAILABLE_TEMPLATE_NAMES, buildBrandFromTemplate } from "../data/templateStore";
import { processDueOutbox } from "../jobs/outboxProcessor";
import {
  autopilotSettingsUpsertSchema,
  type AutopilotChannel,
  type AutopilotGoal,
} from "../schemas/autopilotSettingsSchema";
import { autopilotRunRequestSchema } from "../schemas/autopilotRunSchema";
import { brandProfileSchema, type BrandProfile, type BrandRegistryItem } from "../schemas/brandSchema";
import {
  emailSubscriptionUpdateSchema,
  emailSubscriptionUpsertSchema,
} from "../schemas/emailSubscriptionSchema";
import {
  emailDigestSendRequestSchema,
} from "../schemas/emailSendSchema";
import { gbpPostSchema } from "../schemas/gbpSchema";
import { historyRecordSchema, type HistoryRecord } from "../schemas/historySchema";
import { metricsRequestSchema, storedMetricsSchema, type StoredMetrics } from "../schemas/metricsSchema";
import { outboxRecordSchema, type OutboxRecord } from "../schemas/outboxSchema";
import { publishRequestSchema } from "../schemas/publishSchema";
import { postRequestSchema, storedPostSchema, type StoredPost } from "../schemas/postSchema";
import {
  scheduleCreateRequestSchema,
  scheduleStatusSchema,
  scheduleUpdateRequestSchema,
} from "../schemas/scheduleSchema";
import { smsCampaignRequestSchema } from "../schemas/smsCampaignSchema";
import { smsContactUpsertSchema } from "../schemas/smsContactSchema";
import { smsSendRequestSchema } from "../schemas/smsSendSchema";
import { runAutopilotForBrand } from "../services/autopilotService";
import { buildDigestPreview } from "../services/digestService";
import { buildTodayTasks } from "../services/todayService";
import { getStorageMode, getAdapter } from "../storage/getAdapter";
import { extractAuthToken, resolveAuthUser } from "../supabase/verifyAuth";
import { normalizeUSPhone } from "../utils/phone";

const router = Router();

const BUSINESS_TYPES = [
  "loaded-tea",
  "cafe",
  "fitness-hybrid",
  "restaurant",
  "retail",
  "service",
  "other",
] as const;
const COMMUNITY_LOCAL_TONES = ["neighborly", "bold-local", "supportive", "hometown-pride"] as const;
const COMMUNITY_COLLAB_LEVELS = ["low", "medium", "high"] as const;
const COMMUNITY_AUDIENCE_STYLES = [
  "everyone",
  "young-professionals",
  "fitness",
  "blue-collar",
  "creative",
  "mixed",
] as const;

const POST_PLATFORMS = ["facebook", "instagram", "tiktok", "other"] as const;
const POST_MEDIA_TYPES = ["photo", "reel", "story", "text"] as const;
const METRIC_WINDOWS = ["24h", "48h", "7d"] as const;
const SCHEDULE_STATUSES = ["planned", "posted", "skipped"] as const;
const AUTOPILOT_GOALS: AutopilotGoal[] = ["new_customers", "repeat_customers", "slow_hours"];
const AUTOPILOT_CHANNELS: AutopilotChannel[] = [
  "facebook",
  "instagram",
  "tiktok",
  "google_business",
  "other",
];
const AUTOPILOT_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
] as const;

type GeneratorKind = "promo" | "social" | "events" | "week-plan" | "next-week-plan";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function snippet(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function toLocalUserIdFromEmail(email: string): string {
  const base = email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "local-user";
}

function serializeAuthCookie(token: string, maxAgeSeconds = 60 * 60 * 12): string {
  return `msai_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

function clearAuthCookie(): string {
  return "msai_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
}

function toListInput(value: string[]): string {
  return value.join("\n");
}

function parseStringList(raw: unknown): string[] {
  if (typeof raw !== "string") {
    return [];
  }

  return raw
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function checkbox(raw: unknown): boolean {
  return raw === "on" || raw === "true" || raw === "1";
}

function selectedBrandIdFromQuery(brands: BrandRegistryItem[], raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim() !== "") {
    const matched = brands.find((brand) => brand.brandId === raw);
    if (matched) {
      return matched.brandId;
    }
  }

  if (brands.length > 0) {
    return brands[0].brandId;
  }

  return null;
}

function renderLayout(
  title: string,
  content: string,
  notice?: { type: "success" | "error"; text: string },
): string {
  const noticeHtml = notice
    ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)} - MainStreetAI Admin</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fa; color: #111827; }
      .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
      h1, h2, h3 { margin-top: 0; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(240px,1fr)); gap: 12px; }
      .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
      .field input, .field textarea, .field select {
        border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-size: 14px; width: 100%; box-sizing: border-box;
      }
      .field textarea { min-height: 80px; resize: vertical; font-family: Arial, sans-serif; }
      .button, button {
        border: 1px solid #2563eb; background: #2563eb; color: #fff; padding: 8px 12px; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block;
      }
      .button.secondary, button.secondary { background: #fff; color: #1f2937; border-color: #cbd5e1; }
      .button.small, button.small { padding: 6px 10px; font-size: 13px; }
      .nav { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
      .notice { border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; }
      .notice.success { background: #ecfdf5; border: 1px solid #86efac; }
      .notice.error { background: #fef2f2; border: 1px solid #fca5a5; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 8px; vertical-align: top; }
      pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; overflow: auto; max-height: 460px; }
      .copy-item { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fff; }
      .copy-item textarea { width: 100%; min-height: 70px; margin: 8px 0; }
      .muted { color: #6b7280; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="nav">
        <a class="button secondary small" href="/app">Easy Mode</a>
        <a class="button secondary small" href="/admin">Home</a>
        <a class="button secondary small" href="/admin/brands">Brands</a>
        <a class="button secondary small" href="/admin/integrations">Integrations</a>
        <a class="button secondary small" href="/admin/sms">SMS</a>
        <a class="button secondary small" href="/admin/email">Email</a>
        <a class="button secondary small" href="/admin/media">Media</a>
        <a class="button secondary small" href="/admin/timing">Timing</a>
        <a class="button secondary small" href="/admin/post-now">Post Now</a>
        <a class="button secondary small" href="/admin/voice">Voice</a>
        <a class="button secondary small" href="/admin/locations">Locations</a>
        <a class="button secondary small" href="/admin/tenant/settings">Tenant</a>
        <a class="button secondary small" href="/admin/billing">Billing</a>
        <a class="button secondary small" href="/admin/team">Team</a>
        <a class="button secondary small" href="/admin/schedule">Planned Posts</a>
        <a class="button secondary small" href="/admin/autopilot">Automatic Help</a>
        <a class="button secondary small" href="/admin/alerts">Alerts</a>
        <a class="button secondary small" href="/admin/tomorrow">Tomorrow</a>
        <a class="button secondary small" href="/admin/local-events">Local Events</a>
        <a class="button secondary small" href="/admin/today">Today</a>
        <a class="button secondary small" href="/admin/logout">Logout</a>
      </div>
      ${noticeHtml}
      ${content}
    </div>
  </body>
</html>`;
}

function renderBrandSelector(
  brands: BrandRegistryItem[],
  selectedBrandId: string | null,
  actionPath: string,
): string {
  if (brands.length === 0) {
    return `<p>No brands found yet. <a class="button small" href="/admin/brands/new">Create your first brand</a></p>`;
  }

  const options = brands
    .map((brand) => {
      const selected = brand.brandId === selectedBrandId ? "selected" : "";
      return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
        `${brand.businessName} (${brand.brandId})`,
      )}</option>`;
    })
    .join("");

  return `
    <form class="row" method="GET" action="${escapeHtml(actionPath)}">
      <label><strong>Business</strong></label>
      <select name="brandId" onchange="this.form.submit()">${options}</select>
      <noscript><button type="submit" class="button small">Load</button></noscript>
    </form>
  `;
}

function renderBrandForm(
  action: string,
  submitLabel: string,
  brand?: Partial<BrandProfile>,
  readonlyBrandId = false,
): string {
  const constraints = brand?.constraints ?? {
    noHugeDiscounts: true,
    keepPromosSimple: true,
    avoidCorporateLanguage: true,
    avoidControversy: true,
  };
  const communityVibe = brand?.communityVibeProfile ?? {
    localTone: "neighborly",
    collaborationLevel: "medium",
    localIdentityTags: [],
    audienceStyle: "mixed",
    avoidCorporateTone: true,
  };

  const typeOptions = BUSINESS_TYPES.map((typeValue) => {
    const selected = brand?.type === typeValue ? "selected" : "";
    return `<option value="${typeValue}" ${selected}>${typeValue}</option>`;
  }).join("");
  const localToneOptions = COMMUNITY_LOCAL_TONES.map((tone) => {
    const selected = communityVibe.localTone === tone ? "selected" : "";
    return `<option value="${tone}" ${selected}>${tone}</option>`;
  }).join("");
  const collabOptions = COMMUNITY_COLLAB_LEVELS.map((level) => {
    const selected = communityVibe.collaborationLevel === level ? "selected" : "";
    return `<option value="${level}" ${selected}>${level}</option>`;
  }).join("");
  const audienceStyleOptions = COMMUNITY_AUDIENCE_STYLES.map((style) => {
    const selected = communityVibe.audienceStyle === style ? "selected" : "";
    return `<option value="${style}" ${selected}>${style}</option>`;
  }).join("");

  const readonlyAttr = readonlyBrandId ? "readonly" : "";

  return `
    <form method="POST" action="${escapeHtml(action)}" class="card">
      <div class="grid">
        <div class="field">
          <label>Brand ID (slug)</label>
          <input name="brandId" ${readonlyAttr} required value="${escapeHtml(brand?.brandId ?? "")}" />
        </div>
        <div class="field">
          <label>Business Name</label>
          <input name="businessName" required value="${escapeHtml(brand?.businessName ?? "")}" />
        </div>
        <div class="field">
          <label>Location</label>
          <input name="location" required value="${escapeHtml(brand?.location ?? "")}" />
        </div>
        <div class="field">
          <label>Town Ref (optional)</label>
          <input name="townRef" value="${escapeHtml(brand?.townRef ?? "")}" />
        </div>
        <div class="field">
          <label>Type</label>
          <select name="type">${typeOptions}</select>
        </div>
      </div>

      <div class="field">
        <label>Voice</label>
        <textarea name="voice" required>${escapeHtml(brand?.voice ?? "")}</textarea>
      </div>

      <div class="grid">
        <div class="field">
          <label>Audiences (comma or newline separated)</label>
          <textarea name="audiences">${escapeHtml(toListInput(brand?.audiences ?? []))}</textarea>
        </div>
        <div class="field">
          <label>Products / Services (comma or newline separated)</label>
          <textarea name="productsOrServices">${escapeHtml(
            toListInput(brand?.productsOrServices ?? []),
          )}</textarea>
        </div>
      </div>

      <div class="grid">
        <div class="field">
          <label>Hours</label>
          <input name="hours" required value="${escapeHtml(brand?.hours ?? "")}" />
        </div>
        <div class="field">
          <label>Typical Rush Times</label>
          <input name="typicalRushTimes" required value="${escapeHtml(brand?.typicalRushTimes ?? "")}" />
        </div>
        <div class="field">
          <label>Slow Hours</label>
          <input name="slowHours" required value="${escapeHtml(brand?.slowHours ?? "")}" />
        </div>
      </div>

      <div class="field">
        <label>Offers We Can Use (comma or newline separated)</label>
        <textarea name="offersWeCanUse">${escapeHtml(toListInput(brand?.offersWeCanUse ?? []))}</textarea>
      </div>

      <h3>Community Vibe</h3>
      <div class="grid">
        <div class="field">
          <label>Local tone</label>
          <select name="communityLocalTone">${localToneOptions}</select>
        </div>
        <div class="field">
          <label>Collaboration level</label>
          <select name="communityCollaborationLevel">${collabOptions}</select>
        </div>
        <div class="field">
          <label>Audience style</label>
          <select name="communityAudienceStyle">${audienceStyleOptions}</select>
        </div>
      </div>
      <div class="field">
        <label>Local identity tags (comma or newline separated)</label>
        <textarea name="communityLocalIdentityTags">${escapeHtml(
          toListInput(communityVibe.localIdentityTags ?? []),
        )}</textarea>
      </div>
      <div class="grid">
        <label><input type="checkbox" name="communityAvoidCorporateTone" ${
          communityVibe.avoidCorporateTone ? "checked" : ""
        } /> Avoid corporate tone</label>
      </div>

      <div class="grid">
        <label><input type="checkbox" name="noHugeDiscounts" ${constraints.noHugeDiscounts ? "checked" : ""} /> No huge discounts</label>
        <label><input type="checkbox" name="keepPromosSimple" ${constraints.keepPromosSimple ? "checked" : ""} /> Keep promos simple</label>
        <label><input type="checkbox" name="avoidCorporateLanguage" ${constraints.avoidCorporateLanguage ? "checked" : ""} /> Avoid corporate language</label>
        <label><input type="checkbox" name="avoidControversy" ${constraints.avoidControversy ? "checked" : ""} /> Avoid controversy</label>
      </div>

      <div style="margin-top: 12px;">
        <button type="submit">${escapeHtml(submitLabel)}</button>
      </div>
    </form>
  `;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatDateTimeLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseLocalDateTimeToIso(value: unknown): string {
  const raw = String(value ?? "").trim();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date-time value");
  }
  return parsed.toISOString();
}

function resolveBufferProfileId(
  config: unknown,
  platform: "facebook" | "instagram" | "tiktok" | "other",
  preferredProfileId?: string,
): string | null {
  if (typeof config !== "object" || config === null) {
    return null;
  }

  const profiles = Array.isArray((config as { profiles?: unknown }).profiles)
    ? ((config as { profiles: unknown[] }).profiles
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id.trim() : "";
          const service = typeof record.service === "string" ? record.service.toLowerCase() : "";
          if (!id) {
            return null;
          }
          return { id, service };
        })
        .filter((entry): entry is { id: string; service: string } => entry !== null))
    : [];

  if (profiles.length === 0) {
    const map = (config as { channelIdByPlatform?: Record<string, string> }).channelIdByPlatform ?? {};
    const mapped = map[platform] ?? map.other;
    return typeof mapped === "string" && mapped.trim() !== "" ? mapped.trim() : null;
  }

  if (preferredProfileId) {
    const selected = profiles.find((entry) => entry.id === preferredProfileId);
    if (selected) {
      return selected.id;
    }
  }

  const needle =
    platform === "facebook"
      ? "facebook"
      : platform === "instagram"
        ? "instagram"
        : platform === "tiktok"
          ? "tiktok"
          : "";
  if (needle) {
    const matched = profiles.find((entry) => entry.service.includes(needle));
    if (matched) {
      return matched.id;
    }
  }

  return profiles[0]?.id ?? null;
}

function parseBrandForm(body: Record<string, unknown>): BrandProfile {
  return brandProfileSchema.parse({
    brandId: String(body.brandId ?? "")
      .trim()
      .toLowerCase(),
    businessName: String(body.businessName ?? "").trim(),
    location: String(body.location ?? "").trim(),
    townRef: optionalText(body.townRef),
    type: String(body.type ?? "other"),
    voice: String(body.voice ?? "").trim(),
    audiences: parseStringList(body.audiences),
    productsOrServices: parseStringList(body.productsOrServices),
    hours: String(body.hours ?? "").trim(),
    typicalRushTimes: String(body.typicalRushTimes ?? "").trim(),
    slowHours: String(body.slowHours ?? "").trim(),
    offersWeCanUse: parseStringList(body.offersWeCanUse),
    constraints: {
      noHugeDiscounts: checkbox(body.noHugeDiscounts),
      keepPromosSimple: checkbox(body.keepPromosSimple),
      avoidCorporateLanguage: checkbox(body.avoidCorporateLanguage),
      avoidControversy: checkbox(body.avoidControversy),
    },
    communityVibeProfile: {
      localTone: String(body.communityLocalTone ?? "neighborly"),
      collaborationLevel: String(body.communityCollaborationLevel ?? "medium"),
      localIdentityTags: parseStringList(body.communityLocalIdentityTags),
      audienceStyle: String(body.communityAudienceStyle ?? "mixed"),
      avoidCorporateTone: checkbox(body.communityAvoidCorporateTone),
    },
  });
}

function parseAutopilotGoals(raw: unknown): AutopilotGoal[] {
  if (!Array.isArray(raw)) {
    const single = typeof raw === "string" ? [raw] : [];
    return single.filter((entry): entry is AutopilotGoal =>
      AUTOPILOT_GOALS.includes(entry as AutopilotGoal),
    );
  }
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry): entry is AutopilotGoal => AUTOPILOT_GOALS.includes(entry as AutopilotGoal));
}

function parseAutopilotChannels(raw: unknown): AutopilotChannel[] {
  if (!Array.isArray(raw)) {
    const single = typeof raw === "string" ? [raw] : [];
    return single.filter((entry): entry is AutopilotChannel =>
      AUTOPILOT_CHANNELS.includes(entry as AutopilotChannel),
    );
  }
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry): entry is AutopilotChannel =>
      AUTOPILOT_CHANNELS.includes(entry as AutopilotChannel),
    );
}

function parseAutopilotSettingsForm(body: Record<string, unknown>) {
  const notifySmsRaw = optionalText(body.notifySms);
  return autopilotSettingsUpsertSchema.parse({
    enabled: checkbox(body.enabled),
    cadence: String(body.cadence ?? "daily"),
    hour: Number(body.hour ?? 7),
    timezone: String(body.timezone ?? "America/Chicago"),
    goals: parseAutopilotGoals(body.goals),
    focusAudiences: parseStringList(body.focusAudiences),
    channels: parseAutopilotChannels(body.channels),
    allowDiscounts: checkbox(body.allowDiscounts),
    maxDiscountText: optionalText(body.maxDiscountText),
    notifyEmail: optionalText(body.notifyEmail),
    notifySms: notifySmsRaw ? normalizeUSPhone(notifySmsRaw) : undefined,
  });
}

function tomorrowDateInputValue(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function generatorConfig(kind: GeneratorKind): {
  title: string;
  apiPath: string;
  fieldsHtml: string;
  payloadScript: string;
} {
  switch (kind) {
    case "promo":
      return {
        title: "Generate Promo",
        apiPath: "/promo",
        fieldsHtml: `
          <div class="grid">
            <div class="field"><label>Date label</label><input name="dateLabel" value="Thursday" required /></div>
            <div class="field">
              <label>Weather</label>
              <select name="weather">
                <option>cold</option><option>hot</option><option>rainy</option><option>windy</option><option selected>nice</option>
              </select>
            </div>
            <div class="field">
              <label>Goal</label>
              <select name="goal">
                <option value="new_customers">new_customers</option>
                <option value="repeat_customers">repeat_customers</option>
                <option value="slow_hours" selected>slow_hours</option>
              </select>
            </div>
            <div class="field"><label>Slow hours (optional)</label><input name="slowHours" value="" placeholder="1:00pm-3:00pm" /></div>
          </div>
          <div class="field"><label>Inventory notes (optional)</label><textarea name="inventoryNotes"></textarea></div>
          <label><input type="checkbox" name="includeLocalEvents" /> Include local events for tie-ins</label>
        `,
        payloadScript: `
          payload = {
            dateLabel: String(fd.get("dateLabel") || ""),
            weather: String(fd.get("weather") || ""),
            goal: String(fd.get("goal") || ""),
            includeLocalEvents: fd.get("includeLocalEvents") === "on",
            ...(String(fd.get("slowHours") || "").trim() ? { slowHours: String(fd.get("slowHours")).trim() } : {}),
            ...(String(fd.get("inventoryNotes") || "").trim() ? { inventoryNotes: String(fd.get("inventoryNotes")).trim() } : {})
          };
        `,
      };
    case "social":
      return {
        title: "Generate Social",
        apiPath: "/social",
        fieldsHtml: `
          <div class="grid">
            <div class="field"><label>Today's special</label><input name="todaySpecial" value="Blue raspberry loaded tea" required /></div>
            <div class="field"><label>Audience</label><input name="audience" value="teachers and parents" required /></div>
            <div class="field">
              <label>Tone</label>
              <select name="tone"><option>fun</option><option>cozy</option><option>hype</option><option>calm</option></select>
            </div>
          </div>
        `,
        payloadScript: `
          payload = {
            todaySpecial: String(fd.get("todaySpecial") || ""),
            audience: String(fd.get("audience") || ""),
            tone: String(fd.get("tone") || "")
          };
        `,
      };
    case "events":
      return {
        title: "Generate Event Promos",
        apiPath: "/events",
        fieldsHtml: `
          <div class="field">
            <label>Events JSON array</label>
            <textarea name="eventsJson" required>[{"name":"Friday Night Basketball","time":"7:00pm","audience":"families"}]</textarea>
          </div>
          <div class="field"><label>Notes (optional)</label><textarea name="notes"></textarea></div>
        `,
        payloadScript: `
          payload = {
            events: JSON.parse(String(fd.get("eventsJson") || "[]")),
            ...(String(fd.get("notes") || "").trim() ? { notes: String(fd.get("notes")).trim() } : {})
          };
        `,
      };
    case "week-plan":
      return {
        title: "Generate Week Plan",
        apiPath: "/week-plan",
        fieldsHtml: `
          <div class="grid">
            <div class="field"><label>Start date</label><input type="date" name="startDate" required /></div>
            <div class="field">
              <label>Goal</label>
              <select name="goal">
                <option value="new_customers">new_customers</option>
                <option value="repeat_customers" selected>repeat_customers</option>
                <option value="slow_hours">slow_hours</option>
              </select>
            </div>
            <div class="field"><label>Focus audience (optional)</label><input name="focusAudience" /></div>
          </div>
          <div class="field"><label>Weather week (optional)</label><input name="weatherWeek" /></div>
          <div class="field"><label>Notes (optional)</label><textarea name="notes"></textarea></div>
          <label><input type="checkbox" name="includeLocalEvents" /> Include local events for tie-ins</label>
        `,
        payloadScript: `
          payload = {
            startDate: String(fd.get("startDate") || ""),
            goal: String(fd.get("goal") || ""),
            includeLocalEvents: fd.get("includeLocalEvents") === "on",
            ...(String(fd.get("focusAudience") || "").trim() ? { focusAudience: String(fd.get("focusAudience")).trim() } : {}),
            ...(String(fd.get("weatherWeek") || "").trim() ? { weatherWeek: String(fd.get("weatherWeek")).trim() } : {}),
            ...(String(fd.get("notes") || "").trim() ? { notes: String(fd.get("notes")).trim() } : {})
          };
        `,
      };
    case "next-week-plan":
      return {
        title: "Generate Next Week Plan",
        apiPath: "/next-week-plan",
        fieldsHtml: `
          <div class="grid">
            <div class="field"><label>Start date</label><input type="date" name="startDate" required /></div>
            <div class="field">
              <label>Goal</label>
              <select name="goal">
                <option value="new_customers">new_customers</option>
                <option value="repeat_customers" selected>repeat_customers</option>
                <option value="slow_hours">slow_hours</option>
              </select>
            </div>
            <div class="field"><label>Focus audience (optional)</label><input name="focusAudience" /></div>
          </div>
          <div class="field"><label>Notes (optional)</label><textarea name="notes"></textarea></div>
          <label><input type="checkbox" name="includeLocalEvents" /> Include local events for tie-ins</label>
        `,
        payloadScript: `
          payload = {
            startDate: String(fd.get("startDate") || ""),
            goal: String(fd.get("goal") || ""),
            includeLocalEvents: fd.get("includeLocalEvents") === "on",
            ...(String(fd.get("focusAudience") || "").trim() ? { focusAudience: String(fd.get("focusAudience")).trim() } : {}),
            ...(String(fd.get("notes") || "").trim() ? { notes: String(fd.get("notes")).trim() } : {})
          };
        `,
      };
    default:
      throw new Error(`Unknown generator kind: ${kind}`);
  }
}

function renderGeneratorScript(kind: GeneratorKind, apiPath: string, payloadScript: string): string {
  return `
  <script>
    const form = document.getElementById("generator-form");
    const output = document.getElementById("generator-output");
    const copyItems = document.getElementById("copy-items");
    const signLinkWrap = document.getElementById("sign-link-wrap");
    const generatorKind = ${JSON.stringify(kind)};

    function htmlEscape(text) {
      return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function buildCopyItems(kind, result) {
      const items = [];
      if (kind === "promo") {
        if (result.socialCaption) items.push({ label: "Social Caption", text: result.socialCaption });
        if (result.smsText) items.push({ label: "SMS Text", text: result.smsText });
        if (result.inStoreSign) items.push({ label: "In-Store Sign", text: result.inStoreSign });
        if (result.offer) items.push({ label: "Offer", text: result.offer });
      } else if (kind === "social") {
        if (Array.isArray(result.hookLines)) {
          result.hookLines.forEach((hook, idx) => items.push({ label: "Hook " + (idx + 1), text: hook }));
        }
        if (result.caption) items.push({ label: "Main Caption", text: result.caption });
        if (result.postVariants && result.postVariants.facebook) items.push({ label: "Facebook", text: result.postVariants.facebook });
        if (result.postVariants && result.postVariants.instagram) items.push({ label: "Instagram", text: result.postVariants.instagram });
        if (result.postVariants && result.postVariants.tiktok) items.push({ label: "TikTok", text: result.postVariants.tiktok });
      } else if (kind === "events") {
        if (Array.isArray(result.suggestions)) {
          result.suggestions.forEach((entry, idx) => {
            if (entry.caption) items.push({ label: "Event " + (idx + 1) + " Caption", text: entry.caption });
            if (entry.simpleOffer) items.push({ label: "Event " + (idx + 1) + " Offer", text: entry.simpleOffer });
          });
        }
      } else if (kind === "week-plan" || kind === "next-week-plan") {
        if (Array.isArray(result.dailyPlan)) {
          result.dailyPlan.forEach((day, idx) => {
            if (day.post && day.post.hook) items.push({ label: "Day " + (idx + 1) + " Hook", text: day.post.hook });
            if (day.post && day.post.caption) items.push({ label: "Day " + (idx + 1) + " Caption", text: day.post.caption });
            if (day.inStoreSign) items.push({ label: "Day " + (idx + 1) + " In-Store Sign", text: day.inStoreSign });
          });
        }
      }
      return items;
    }

    function buildSignUrl(kind, result, brandId) {
      let promoName = "";
      let offer = "";
      let when = "";
      let line = "";

      if (kind === "promo") {
        promoName = result.promoName || "";
        offer = result.offer || "";
        when = result.when || "";
        line = result.inStoreSign || "";
      } else if ((kind === "week-plan" || kind === "next-week-plan") && Array.isArray(result.dailyPlan) && result.dailyPlan.length > 0) {
        const day = result.dailyPlan[0] || {};
        promoName = day.promoName || "";
        offer = day.offer || "";
        when = day.timeWindow || "";
        line = day.inStoreSign || "";
      }

      if (!promoName && !offer && !line) {
        return null;
      }

      const params = new URLSearchParams({
        brandId: brandId,
        promoName: promoName,
        offer: offer,
        when: when,
        line: line
      });
      return "/sign.pdf?" + params.toString();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      output.textContent = "Generating...";
      copyItems.innerHTML = "";
      signLinkWrap.innerHTML = "";

      try {
        const fd = new FormData(form);
        const brandId = String(fd.get("brandId") || "");
        let payload = {};
        ${payloadScript}

        const response = await fetch(${JSON.stringify(apiPath)} + "?brandId=" + encodeURIComponent(brandId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const json = await response.json().catch(() => ({ error: "Non-JSON response" }));
        if (!response.ok) {
          output.textContent = JSON.stringify(json, null, 2);
          return;
        }

        output.textContent = JSON.stringify(json, null, 2);

        const items = buildCopyItems(generatorKind, json);
        copyItems.innerHTML = items.map((item, index) => {
          return '<div class="copy-item"><strong>' + htmlEscape(item.label) + '</strong><textarea id="copy-' + index + '">' + htmlEscape(item.text || "") + '</textarea><button type="button" class="button small secondary" data-target="copy-' + index + '">Copy</button></div>';
        }).join("");

        copyItems.querySelectorAll("button[data-target]").forEach((button) => {
          button.addEventListener("click", async () => {
            const targetId = button.getAttribute("data-target");
            const source = targetId ? document.getElementById(targetId) : null;
            if (!source) return;
            await navigator.clipboard.writeText(source.value || "");
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = "Copy"; }, 1000);
          });
        });

        const signUrl = buildSignUrl(generatorKind, json, brandId);
        if (signUrl) {
          signLinkWrap.innerHTML = '<a class="button small" target="_blank" href="' + signUrl + '">Open Printable Sign PDF</a>';
        }
      } catch (error) {
        output.textContent = String(error && error.message ? error.message : error);
      }
    });
  </script>
  `;
}

router.get("/login", (req, res) => {
  const mode = getStorageMode();
  const status = optionalText(req.query.error);
  const notice =
    status === "1"
      ? { type: "error" as const, text: "Login failed. Check credentials and try again." }
      : undefined;

  const html = renderLayout(
    "Admin Login",
    `
    <div class="card">
      <h1>Admin Login</h1>
      <p class="muted">Storage mode: ${escapeHtml(mode)}</p>
      <form method="POST" action="/admin/login">
        <div class="field"><label>Email</label><input type="email" name="email" required /></div>
        <div class="field"><label>Password</label><input type="password" name="password" required /></div>
        <button type="submit">Log In</button>
      </form>
      ${
        mode === "local"
          ? `<p class="muted" style="margin-top:10px;">Local mode accepts any email/password and creates a local user token.</p>`
          : ""
      }
    </div>
    `,
    notice,
  );
  return res.type("html").send(html);
});

router.post("/login", async (req, res, next) => {
  try {
    const mode = getStorageMode();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) {
      return res.redirect("/admin/login?error=1");
    }

    if (mode === "local") {
      const userId = toLocalUserIdFromEmail(email);
      const token = `local:${userId}|${email}`;
      res.setHeader("Set-Cookie", serializeAuthCookie(token));
      return res.redirect("/app");
    }

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return res.redirect("/admin/login?error=1");
    }

    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      return res.redirect("/admin/login?error=1");
    }

    res.setHeader("Set-Cookie", serializeAuthCookie(data.session.access_token));
    return res.redirect("/app");
  } catch (error) {
    return next(error);
  }
});

router.get("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearAuthCookie());
  return res.redirect("/admin/login");
});

router.use(async (req, res, next) => {
  if (req.path === "/login" || req.path === "/logout") {
    return next();
  }

  const token = extractAuthToken(req);
  if (!token) {
    return res.redirect("/admin/login");
  }

  const user = await resolveAuthUser(token);
  if (!user) {
    return res.redirect("/admin/login");
  }

  req.user = user;
  return next();
});

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);

    let historyRows = `<tr><td colspan="5" class="muted">Select a business to see history.</td></tr>`;
    if (selectedBrandId) {
      const records = await adapter.listHistory(userId, selectedBrandId, 10);
      const parsed = records
        .map((record) => historyRecordSchema.safeParse(record))
        .filter((result): result is { success: true; data: HistoryRecord } => result.success)
        .map((result) => result.data);

      historyRows =
        parsed.length > 0
          ? parsed
              .map((record) => {
                const historyUrl = `/history/${encodeURIComponent(record.id)}?brandId=${encodeURIComponent(
                  selectedBrandId,
                )}`;
                const signUrl = `/sign.pdf?brandId=${encodeURIComponent(
                  selectedBrandId,
                )}&historyId=${encodeURIComponent(record.id)}`;
                return `<tr>
                  <td>${escapeHtml(formatDateTime(record.createdAt))}</td>
                  <td>${escapeHtml(record.endpoint)}</td>
                  <td><code>${escapeHtml(record.id)}</code></td>
                  <td><a class="button small secondary" target="_blank" href="${historyUrl}">View JSON</a></td>
                  <td><a class="button small secondary" target="_blank" href="${signUrl}">Print Sign</a></td>
                </tr>`;
              })
              .join("")
          : `<tr><td colspan="5" class="muted">No history yet for this brand.</td></tr>`;
    }

    const actionButtons =
      selectedBrandId !== null
        ? `
      <div class="row">
        <a class="button" href="/admin/generate/promo?brandId=${encodeURIComponent(selectedBrandId)}">Promo</a>
        <a class="button" href="/admin/generate/social?brandId=${encodeURIComponent(selectedBrandId)}">Social</a>
        <a class="button" href="/admin/generate/events?brandId=${encodeURIComponent(selectedBrandId)}">Events</a>
        <a class="button" href="/admin/generate/week-plan?brandId=${encodeURIComponent(selectedBrandId)}">Plan My Week</a>
        <a class="button" href="/admin/generate/next-week-plan?brandId=${encodeURIComponent(selectedBrandId)}">Plan My Next Week</a>
      </div>
      <div class="row" style="margin-top: 10px;">
        <a class="button secondary" href="/admin/posts?brandId=${encodeURIComponent(selectedBrandId)}">Posted History</a>
        <a class="button secondary" href="/admin/metrics?brandId=${encodeURIComponent(selectedBrandId)}">How did it perform?</a>
        <a class="button secondary" href="/admin/autopilot?brandId=${encodeURIComponent(selectedBrandId)}">Automatic Help</a>
        <a class="button secondary" href="/admin/alerts?brandId=${encodeURIComponent(selectedBrandId)}">Alerts</a>
        <a class="button secondary" href="/admin/tomorrow?brandId=${encodeURIComponent(selectedBrandId)}">Tomorrow Pack</a>
        <a class="button secondary" href="/admin/billing?brandId=${encodeURIComponent(selectedBrandId)}">Billing</a>
        <a class="button secondary" href="/admin/team?brandId=${encodeURIComponent(selectedBrandId)}">Team</a>
        <a class="button secondary" href="/admin/integrations?brandId=${encodeURIComponent(selectedBrandId)}">Integrations</a>
        <a class="button secondary" href="/admin/sms?brandId=${encodeURIComponent(selectedBrandId)}">SMS</a>
        <a class="button secondary" href="/admin/email?brandId=${encodeURIComponent(selectedBrandId)}">Email</a>
        <a class="button secondary" href="/admin/gbp?brandId=${encodeURIComponent(selectedBrandId)}">GBP Post</a>
        <a class="button secondary" href="/admin/schedule?brandId=${encodeURIComponent(selectedBrandId)}">Planned Posts</a>
        <a class="button secondary" href="/admin/local-events?brandId=${encodeURIComponent(selectedBrandId)}">Local Events</a>
        <a class="button secondary" href="/admin/today?brandId=${encodeURIComponent(selectedBrandId)}">Today's Checklist</a>
      </div>`
        : `<p class="muted">Create a brand to unlock generation and tracking.</p>`;

    const html = renderLayout(
      "Admin Home",
      `
      <div class="card">
        <h1>MainStreetAI Admin</h1>
        <p class="muted">Pick a business, generate content, copy captions, and manage logs.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin")}
        ${actionButtons}
      </div>

      <div class="card">
        <h2>Recent History (last 10)</h2>
        <table>
          <thead><tr><th>Time</th><th>Endpoint</th><th>ID</th><th>History</th><th>Sign PDF</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
      `,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/brands", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brands = await getAdapter().listBrands(userId);
    const status = optionalText(req.query.status);

    const rows =
      brands.length > 0
        ? brands
            .map(
              (brand) => `<tr>
              <td>${escapeHtml(brand.businessName)}</td>
              <td>${escapeHtml(brand.brandId)}</td>
              <td>${escapeHtml(brand.location)}</td>
              <td>${escapeHtml(brand.type)}</td>
              <td><a class="button small secondary" href="/admin/brands/${encodeURIComponent(
                brand.brandId,
              )}/edit">Edit</a></td>
            </tr>`,
            )
            .join("")
        : `<tr><td colspan="5" class="muted">No brands created yet.</td></tr>`;

    const notice =
      status === "created"
        ? { type: "success" as const, text: "Brand created." }
        : status === "updated"
          ? { type: "success" as const, text: "Brand updated." }
          : undefined;

    const html = renderLayout(
      "Brand Manager",
      `
      <div class="card">
        <h1>Brand Manager</h1>
        <a class="button" href="/admin/brands/new">Create New Brand</a>
        <a class="button secondary" style="margin-left:8px;" href="/admin/brands/new-from-template">Create From Template</a>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Business</th><th>Brand ID</th><th>Location</th><th>Type</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/brands/new", (_req, res) => {
  const html = renderLayout(
    "Create Brand",
    `
    <div class="card">
      <h1>Create Brand</h1>
      ${renderBrandForm("/admin/brands", "Create Brand")}
    </div>
    `,
  );
  return res.type("html").send(html);
});

router.post("/brands", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseBrandForm(body);
    const created = await getAdapter().createBrand(userId, parsed);
    if (!created) {
      const html = renderLayout(
        "Create Brand",
        `
        <div class="card">
          <h1>Create Brand</h1>
          ${renderBrandForm("/admin/brands", "Create Brand", parsed)}
        </div>
        `,
        { type: "error", text: `Brand '${parsed.brandId}' already exists.` },
      );
      return res.status(409).type("html").send(html);
    }

    return res.redirect("/admin/brands?status=created");
  } catch (error) {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const partialBrand: Partial<BrandProfile> = {
      brandId: String(rawBody.brandId ?? ""),
      businessName: String(rawBody.businessName ?? ""),
      location: String(rawBody.location ?? ""),
      townRef: optionalText(rawBody.townRef),
      type: BUSINESS_TYPES.includes(String(rawBody.type ?? "") as (typeof BUSINESS_TYPES)[number])
        ? (String(rawBody.type) as BrandProfile["type"])
        : "other",
      voice: String(rawBody.voice ?? ""),
      audiences: parseStringList(rawBody.audiences),
      productsOrServices: parseStringList(rawBody.productsOrServices),
      hours: String(rawBody.hours ?? ""),
      typicalRushTimes: String(rawBody.typicalRushTimes ?? ""),
      slowHours: String(rawBody.slowHours ?? ""),
      offersWeCanUse: parseStringList(rawBody.offersWeCanUse),
      constraints: {
        noHugeDiscounts: checkbox(rawBody.noHugeDiscounts),
        keepPromosSimple: checkbox(rawBody.keepPromosSimple),
        avoidCorporateLanguage: checkbox(rawBody.avoidCorporateLanguage),
        avoidControversy: checkbox(rawBody.avoidControversy),
      },
      communityVibeProfile: {
        localTone: String(rawBody.communityLocalTone ?? "neighborly") as
          | "neighborly"
          | "bold-local"
          | "supportive"
          | "hometown-pride",
        collaborationLevel: String(rawBody.communityCollaborationLevel ?? "medium") as
          | "low"
          | "medium"
          | "high",
        localIdentityTags: parseStringList(rawBody.communityLocalIdentityTags),
        audienceStyle: String(rawBody.communityAudienceStyle ?? "mixed") as
          | "everyone"
          | "young-professionals"
          | "fitness"
          | "blue-collar"
          | "creative"
          | "mixed",
        avoidCorporateTone: checkbox(rawBody.communityAvoidCorporateTone),
      },
    };

    const message = error instanceof Error ? error.message : "Invalid brand payload";
    const html = renderLayout(
      "Create Brand",
      `
      <div class="card">
        <h1>Create Brand</h1>
        ${renderBrandForm("/admin/brands", "Create Brand", partialBrand)}
      </div>
      `,
      { type: "error", text: message },
    );
    return res.status(400).type("html").send(html);
  }
});

router.get("/brands/new-from-template", (_req, res) => {
  const templateOptions = AVAILABLE_TEMPLATE_NAMES.map(
    (name) => `<option value="${name}">${name}</option>`,
  ).join("");

  const html = renderLayout(
    "Create Brand From Template",
    `
    <div class="card">
      <h1>Create Brand From Template</h1>
      <form method="POST" action="/admin/brands/new-from-template">
        <div class="grid">
          <div class="field"><label>Brand ID (slug)</label><input name="brandId" required /></div>
          <div class="field"><label>Business Name</label><input name="businessName" required /></div>
          <div class="field"><label>Location</label><input name="location" required /></div>
          <div class="field"><label>Template</label><select name="template">${templateOptions}</select></div>
        </div>
        <button type="submit">Create Brand</button>
      </form>
    </div>
    `,
  );

  return res.type("html").send(html);
});

router.post("/brands/new-from-template", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = await buildBrandFromTemplate({
      brandId: String(body.brandId ?? "")
        .trim()
        .toLowerCase(),
      businessName: String(body.businessName ?? "").trim(),
      location: String(body.location ?? "").trim(),
      template: String(body.template ?? "") as (typeof AVAILABLE_TEMPLATE_NAMES)[number],
    });

    const created = await getAdapter().createBrand(userId, profile);
    if (!created) {
      const html = renderLayout(
        "Create Brand From Template",
        `<p>Brand '${escapeHtml(profile.brandId)}' already exists.</p>`,
        { type: "error", text: "Brand already exists." },
      );
      return res.status(409).type("html").send(html);
    }

    return res.redirect("/admin/brands?status=created");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid template request";
    const templateOptions = AVAILABLE_TEMPLATE_NAMES.map(
      (name) => `<option value="${name}">${name}</option>`,
    ).join("");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const html = renderLayout(
      "Create Brand From Template",
      `
      <div class="card">
        <h1>Create Brand From Template</h1>
        <form method="POST" action="/admin/brands/new-from-template">
          <div class="grid">
            <div class="field"><label>Brand ID (slug)</label><input name="brandId" value="${escapeHtml(String(body.brandId ?? ""))}" required /></div>
            <div class="field"><label>Business Name</label><input name="businessName" value="${escapeHtml(String(body.businessName ?? ""))}" required /></div>
            <div class="field"><label>Location</label><input name="location" value="${escapeHtml(String(body.location ?? ""))}" required /></div>
            <div class="field"><label>Template</label><select name="template">${templateOptions}</select></div>
          </div>
          <button type="submit">Create Brand</button>
        </form>
      </div>
      `,
      { type: "error", text: message },
    );
    return res.status(400).type("html").send(html);
  }
});

router.get("/brands/:brandId/edit", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brand = await getAdapter().getBrand(userId, req.params.brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Brand Not Found", "<h1>Brand not found.</h1>"));
    }

    const html = renderLayout(
      "Edit Brand",
      `
      <div class="card">
        <h1>Edit Brand: ${escapeHtml(brand.businessName)}</h1>
        ${renderBrandForm(`/admin/brands/${encodeURIComponent(brand.brandId)}`, "Save Changes", brand, true)}
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/brands/:brandId", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const body = (req.body ?? {}) as Record<string, unknown>;
    body.brandId = req.params.brandId;
    const parsed = parseBrandForm(body);
    const updated = await getAdapter().updateBrand(userId, req.params.brandId, parsed);
    if (!updated) {
      return res.status(404).type("html").send(renderLayout("Brand Not Found", "<h1>Brand not found.</h1>"));
    }
    return res.redirect("/admin/brands?status=updated");
  } catch (error) {
    const userId = req.user?.id ?? "local-dev-user";
    const existing = await getAdapter().getBrand(userId, req.params.brandId);
    const message = error instanceof Error ? error.message : "Invalid brand payload";
    const html = renderLayout(
      "Edit Brand",
      `
      <div class="card">
        <h1>Edit Brand: ${escapeHtml(req.params.brandId)}</h1>
        ${
          existing
            ? renderBrandForm(`/admin/brands/${encodeURIComponent(existing.brandId)}`, "Save Changes", existing, true)
            : "<p>Brand no longer exists.</p>"
        }
      </div>
      `,
      { type: "error", text: message },
    );
    return res.status(400).type("html").send(html);
  }
});

router.get("/generate/:kind", async (req, res, next) => {
  const kind = req.params.kind as GeneratorKind;
  if (!["promo", "social", "events", "week-plan", "next-week-plan"].includes(kind)) {
    return res.status(404).type("html").send(renderLayout("Not Found", "<h1>Generator not found.</h1>"));
  }

  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const cfg = generatorConfig(kind);

    const html = renderLayout(
      cfg.title,
      `
      <div class="card">
        <h1>${escapeHtml(cfg.title)}</h1>
        ${renderBrandSelector(brands, selectedBrandId, `/admin/generate/${kind}`)}
      </div>
      <div class="card">
        ${
          selectedBrandId
            ? `
          <form id="generator-form">
            <input type="hidden" name="brandId" value="${escapeHtml(selectedBrandId)}" />
            ${cfg.fieldsHtml}
            <button type="submit">Generate</button>
          </form>
          `
            : `<p>Create a brand first to generate content.</p>`
        }
      </div>
      <div class="card">
        <h2>Result</h2>
        <pre id="generator-output">Submit the form to generate content.</pre>
        <div id="sign-link-wrap" style="margin-top: 10px;"></div>
      </div>
      <div class="card">
        <h2>Copy/Paste Ready</h2>
        <div id="copy-items" class="muted">Copy-ready snippets will appear after generation.</div>
      </div>
      ${
        selectedBrandId ? renderGeneratorScript(kind, cfg.apiPath, cfg.payloadScript) : ""
      }
      `,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/posts", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const saved = optionalText(req.query.saved);

    let rows = `<tr><td colspan="7" class="muted">Select a business to view post logs.</td></tr>`;
    if (selectedBrandId) {
      const records = await adapter.listPosts(userId, selectedBrandId, 20);
      const posts = records
        .map((record) => storedPostSchema.safeParse(record))
        .filter((result): result is { success: true; data: StoredPost } => result.success)
        .map((result) => result.data);

      rows =
        posts.length > 0
          ? posts
              .map(
                (post) => `<tr>
                <td><code>${escapeHtml(post.id)}</code></td>
                <td>${escapeHtml(post.platform)}</td>
                <td>${escapeHtml(post.mediaType)}</td>
                <td>${escapeHtml(formatDateTime(post.postedAt))}</td>
                <td>${escapeHtml(post.captionUsed)}</td>
                <td>${escapeHtml(post.promoName ?? "-")}</td>
                <td>${escapeHtml(post.notes ?? "-")}</td>
              </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="muted">No posts logged yet.</td></tr>`;
    }

    const notice =
      saved === "1" ? { type: "success" as const, text: "Post logged." } : undefined;

    const html = renderLayout(
      "Posting Log",
      `
      <div class="card">
        <h1>Posting Log</h1>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/posts")}
      </div>
      <div class="card">
        <h2>Log a Post</h2>
        ${
          selectedBrandId
            ? `
          <form method="POST" action="/admin/posts?brandId=${encodeURIComponent(selectedBrandId)}">
            <div class="grid">
              <div class="field">
                <label>Platform</label>
                <select name="platform">${POST_PLATFORMS.map((platform) => `<option>${platform}</option>`).join("")}</select>
              </div>
              <div class="field">
                <label>Posted At (local time)</label>
                <input name="postedAt" type="datetime-local" required />
              </div>
              <div class="field">
                <label>Media Type</label>
                <select name="mediaType">${POST_MEDIA_TYPES.map((type) => `<option>${type}</option>`).join("")}</select>
              </div>
            </div>
            <div class="field"><label>Caption Used</label><textarea name="captionUsed" required></textarea></div>
            <div class="grid">
              <div class="field"><label>Promo Name (optional)</label><input name="promoName" /></div>
              <div class="field"><label>Notes (optional)</label><input name="notes" /></div>
            </div>
            <button type="submit">Save Post Log</button>
          </form>
          `
            : `<p>Create/select a brand first.</p>`
        }
      </div>
      <div class="card">
        <h2>Recent Post Logs</h2>
        <table>
          <thead><tr><th>ID</th><th>Platform</th><th>Media</th><th>Posted</th><th>Caption</th><th>Promo</th><th>Notes</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/posts", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Posting Log", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Posting Log", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const postedAtInput = String(body.postedAt ?? "").trim();
    const parsedRequest = postRequestSchema.parse({
      platform: String(body.platform ?? ""),
      postedAt: new Date(postedAtInput).toISOString(),
      mediaType: String(body.mediaType ?? ""),
      captionUsed: String(body.captionUsed ?? ""),
      ...(optionalText(body.promoName) ? { promoName: optionalText(body.promoName) } : {}),
      ...(optionalText(body.notes) ? { notes: optionalText(body.notes) } : {}),
    });

    await adapter.addPost(userId, brandId, parsedRequest);

    return res.redirect(`/admin/posts?brandId=${encodeURIComponent(brandId)}&saved=1`);
  } catch (error) {
    return next(error);
  }
});

router.get("/metrics", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const saved = optionalText(req.query.saved);

    let rows = `<tr><td colspan="10" class="muted">Select a business to view metric logs.</td></tr>`;
    if (selectedBrandId) {
      const records = await adapter.listMetrics(userId, selectedBrandId, 20);
      const metrics = records
        .map((record) => storedMetricsSchema.safeParse(record))
        .filter((result): result is { success: true; data: StoredMetrics } => result.success)
        .map((result) => result.data);

      rows =
        metrics.length > 0
          ? metrics
              .map(
                (entry) => `<tr>
                <td><code>${escapeHtml(entry.id)}</code></td>
                <td>${escapeHtml(entry.platform)}</td>
                <td>${escapeHtml(entry.window)}</td>
                <td>${entry.views ?? "-"}</td>
                <td>${entry.likes ?? "-"}</td>
                <td>${entry.comments ?? "-"}</td>
                <td>${entry.shares ?? "-"}</td>
                <td>${entry.saves ?? "-"}</td>
                <td>${entry.clicks ?? "-"}</td>
                <td>${entry.redemptions ?? "-"}</td>
              </tr>`,
              )
              .join("")
          : `<tr><td colspan="10" class="muted">No metrics logged yet.</td></tr>`;
    }

    const notice =
      saved === "1" ? { type: "success" as const, text: "Metrics logged." } : undefined;

    const html = renderLayout(
      "Metrics Log",
      `
      <div class="card">
        <h1>Metrics Log</h1>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/metrics")}
      </div>

      <div class="card">
        <h2>Log Metrics</h2>
        ${
          selectedBrandId
            ? `
          <form method="POST" action="/admin/metrics?brandId=${encodeURIComponent(selectedBrandId)}">
            <div class="grid">
              <div class="field"><label>Platform</label><select name="platform">${POST_PLATFORMS.map((platform) => `<option>${platform}</option>`).join("")}</select></div>
              <div class="field"><label>Window</label><select name="window">${METRIC_WINDOWS.map((window) => `<option>${window}</option>`).join("")}</select></div>
              <div class="field"><label>Post ID (optional)</label><input name="postId" /></div>
            </div>
            <div class="grid">
              <div class="field"><label>Views</label><input type="number" min="0" name="views" /></div>
              <div class="field"><label>Likes</label><input type="number" min="0" name="likes" /></div>
              <div class="field"><label>Comments</label><input type="number" min="0" name="comments" /></div>
              <div class="field"><label>Shares</label><input type="number" min="0" name="shares" /></div>
              <div class="field"><label>Saves</label><input type="number" min="0" name="saves" /></div>
              <div class="field"><label>Clicks</label><input type="number" min="0" name="clicks" /></div>
              <div class="field"><label>Redemptions</label><input type="number" min="0" name="redemptions" /></div>
            </div>
            <div class="field"><label>Sales Notes (optional)</label><textarea name="salesNotes"></textarea></div>
            <button type="submit">Save Metrics</button>
          </form>
          `
            : `<p>Create/select a brand first.</p>`
        }
      </div>

      <div class="card">
        <h2>Recent Metrics</h2>
        <table>
          <thead><tr><th>ID</th><th>Platform</th><th>Window</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Clicks</th><th>Redeem</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/metrics", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Metrics Log", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Metrics Log", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsedRequest = metricsRequestSchema.parse({
      platform: String(body.platform ?? ""),
      postId: optionalText(body.postId),
      window: String(body.window ?? ""),
      views: optionalText(body.views) ? Number(body.views) : undefined,
      likes: optionalText(body.likes) ? Number(body.likes) : undefined,
      comments: optionalText(body.comments) ? Number(body.comments) : undefined,
      shares: optionalText(body.shares) ? Number(body.shares) : undefined,
      saves: optionalText(body.saves) ? Number(body.saves) : undefined,
      clicks: optionalText(body.clicks) ? Number(body.clicks) : undefined,
      redemptions: optionalText(body.redemptions) ? Number(body.redemptions) : undefined,
      salesNotes: optionalText(body.salesNotes),
    });

    await adapter.addMetrics(userId, brandId, parsedRequest);

    return res.redirect(`/admin/metrics?brandId=${encodeURIComponent(brandId)}&saved=1`);
  } catch (error) {
    return next(error);
  }
});

router.get("/local-events", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    let recurringRows = `<tr><td colspan="6" class="muted">Select a business to manage local events.</td></tr>`;
    let oneOffRows = `<tr><td colspan="7" class="muted">Select a business to manage local events.</td></tr>`;

    if (selectedBrandId) {
      const events = await adapter.listLocalEvents(userId, selectedBrandId);
      recurringRows =
        events.recurring.length > 0
          ? events.recurring
              .map(
                (event) => `<tr>
                  <td><code>${escapeHtml(event.eventId)}</code></td>
                  <td>${escapeHtml(event.name)}</td>
                  <td>${escapeHtml(event.pattern)}</td>
                  <td>${escapeHtml(event.audience)}</td>
                  <td>${escapeHtml(event.notes || "-")}</td>
                  <td>
                    <form method="POST" action="/admin/local-events/${encodeURIComponent(
                      event.eventId,
                    )}/delete?brandId=${encodeURIComponent(selectedBrandId)}">
                      <button class="button small secondary" type="submit">Delete</button>
                    </form>
                  </td>
                </tr>`,
              )
              .join("")
          : `<tr><td colspan="6" class="muted">No recurring events yet.</td></tr>`;

      oneOffRows =
        events.oneOff.length > 0
          ? events.oneOff
              .map(
                (event) => `<tr>
                  <td><code>${escapeHtml(event.eventId)}</code></td>
                  <td>${escapeHtml(event.name)}</td>
                  <td>${escapeHtml(event.date)}</td>
                  <td>${escapeHtml(event.time || "-")}</td>
                  <td>${escapeHtml(event.audience)}</td>
                  <td>${escapeHtml(event.notes || "-")}</td>
                  <td>
                    <form method="POST" action="/admin/local-events/${encodeURIComponent(
                      event.eventId,
                    )}/delete?brandId=${encodeURIComponent(selectedBrandId)}">
                      <button class="button small secondary" type="submit">Delete</button>
                    </form>
                  </td>
                </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="muted">No one-off events yet.</td></tr>`;
    }

    const notice =
      status === "added-recurring"
        ? { type: "success" as const, text: "Recurring event added." }
        : status === "added-oneoff"
          ? { type: "success" as const, text: "One-off event added." }
          : status === "pasted"
            ? { type: "success" as const, text: "Event list pasted successfully." }
            : status === "deleted"
              ? { type: "success" as const, text: "Event deleted." }
              : undefined;

    const html = renderLayout(
      "Local Events",
      `
      <div class="card">
        <h1>Local Events</h1>
        <p class="muted">Manage recurring and one-off community events for local-smart content.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/local-events")}
      </div>

      <div class="card">
        <h2>Add Recurring Event</h2>
        ${
          selectedBrandId
            ? `
            <form method="POST" action="/admin/local-events/recurring?brandId=${encodeURIComponent(
              selectedBrandId,
            )}">
              <div class="grid">
                <div class="field"><label>Name</label><input name="name" required /></div>
                <div class="field"><label>Pattern</label><input name="pattern" placeholder="Every Fri" required /></div>
                <div class="field"><label>Audience</label><input name="audience" required /></div>
              </div>
              <div class="field"><label>Notes</label><input name="notes" /></div>
              <button type="submit">Add Recurring Event</button>
            </form>
            `
            : `<p>Create/select a brand first.</p>`
        }
      </div>

      <div class="card">
        <h2>Add One-Off Event</h2>
        ${
          selectedBrandId
            ? `
            <form method="POST" action="/admin/local-events/oneoff?brandId=${encodeURIComponent(
              selectedBrandId,
            )}">
              <div class="grid">
                <div class="field"><label>Name</label><input name="name" required /></div>
                <div class="field"><label>Date</label><input type="date" name="date" required /></div>
                <div class="field"><label>Time</label><input name="time" placeholder="7:00pm" /></div>
                <div class="field"><label>Audience</label><input name="audience" required /></div>
              </div>
              <div class="field"><label>Notes</label><input name="notes" /></div>
              <button type="submit">Add One-Off Event</button>
            </form>
            `
            : `<p>Create/select a brand first.</p>`
        }
      </div>

      <div class="card">
        <h2>Paste Event List (Optional)</h2>
        <p class="muted">Paste JSON with recurring/oneOff arrays. This appends to existing events.</p>
        ${
          selectedBrandId
            ? `
            <form method="POST" action="/admin/local-events/paste?brandId=${encodeURIComponent(
              selectedBrandId,
            )}">
              <div class="field">
                <label>Event JSON</label>
                <textarea name="eventsJson" required>{
  "recurring": [{"name":"Friday Game Night","pattern":"Every Fri","audience":"families","notes":""}],
  "oneOff": [{"name":"Spring Festival","date":"2026-04-18","time":"10:00am","audience":"families","notes":""}]
}</textarea>
              </div>
              <button type="submit">Paste + Append</button>
            </form>
            `
            : `<p>Create/select a brand first.</p>`
        }
      </div>

      <div class="card">
        <h2>Recurring Events</h2>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Pattern</th><th>Audience</th><th>Notes</th><th>Action</th></tr></thead>
          <tbody>${recurringRows}</tbody>
        </table>
      </div>

      <div class="card">
        <h2>One-Off Events</h2>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Date</th><th>Time</th><th>Audience</th><th>Notes</th><th>Action</th></tr></thead>
          <tbody>${oneOffRows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/local-events/recurring", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    await adapter.upsertLocalEvents(userId, brandId, {
      mode: "append",
      recurring: [
        {
          name: String(body.name ?? ""),
          pattern: String(body.pattern ?? ""),
          audience: String(body.audience ?? ""),
          notes: String(body.notes ?? ""),
        },
      ],
    });

    return res.redirect(`/admin/local-events?brandId=${encodeURIComponent(brandId)}&status=added-recurring`);
  } catch (error) {
    return next(error);
  }
});

router.post("/local-events/oneoff", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    await adapter.upsertLocalEvents(userId, brandId, {
      mode: "append",
      oneOff: [
        {
          name: String(body.name ?? ""),
          date: String(body.date ?? ""),
          time: String(body.time ?? ""),
          audience: String(body.audience ?? ""),
          notes: String(body.notes ?? ""),
        },
      ],
    });

    return res.redirect(`/admin/local-events?brandId=${encodeURIComponent(brandId)}&status=added-oneoff`);
  } catch (error) {
    return next(error);
  }
});

router.post("/local-events/paste", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = JSON.parse(String(body.eventsJson ?? "{}")) as {
      recurring?: Array<{ name: string; pattern: string; audience: string; notes?: string }>;
      oneOff?: Array<{ name: string; date: string; time?: string; audience: string; notes?: string }>;
    };

    await adapter.upsertLocalEvents(userId, brandId, {
      mode: "append",
      recurring: (parsed.recurring ?? []).map((event) => ({
        name: event.name,
        pattern: event.pattern,
        audience: event.audience,
        notes: event.notes ?? "",
      })),
      oneOff: (parsed.oneOff ?? []).map((event) => ({
        name: event.name,
        date: event.date,
        time: event.time ?? "",
        audience: event.audience,
        notes: event.notes ?? "",
      })),
    });

    return res.redirect(`/admin/local-events?brandId=${encodeURIComponent(brandId)}&status=pasted`);
  } catch (error) {
    return next(error);
  }
});

router.post("/local-events/:eventId/delete", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const eventId = req.params.eventId?.trim();
    if (!eventId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing event id.</h1>"));
    }

    await adapter.deleteLocalEvent(userId, brandId, eventId);
    return res.redirect(`/admin/local-events?brandId=${encodeURIComponent(brandId)}&status=deleted`);
  } catch (error) {
    return next(error);
  }
});

router.get("/schedule", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    let rows = `<tr><td colspan="8" class="muted">Select a business to view schedule items.</td></tr>`;

    if (selectedBrandId) {
      const items = await adapter.listSchedule(userId, selectedBrandId);
      rows =
        items.length > 0
          ? items
              .map((item) => {
                const statusOptions = SCHEDULE_STATUSES.map((entry) => {
                  const selected = item.status === entry ? "selected" : "";
                  return `<option value="${entry}" ${selected}>${entry}</option>`;
                }).join("");

                return `<tr>
                  <td><code>${escapeHtml(item.id)}</code></td>
                  <td>${escapeHtml(item.title)}</td>
                  <td>${escapeHtml(item.platform)}</td>
                  <td>${escapeHtml(formatDateTime(item.scheduledFor))}</td>
                  <td>${escapeHtml(snippet(item.caption, 80))}</td>
                  <td>${escapeHtml(snippet(item.assetNotes || "-", 60))}</td>
                  <td>${escapeHtml(item.status)}</td>
                  <td>
                    <form method="POST" action="/admin/schedule/${encodeURIComponent(item.id)}/update?brandId=${encodeURIComponent(
                      selectedBrandId,
                    )}">
                      <select name="status">${statusOptions}</select>
                      <button type="submit" class="button small secondary">Update</button>
                    </form>
                    <form style="margin-top:6px;" method="POST" action="/admin/schedule/${encodeURIComponent(
                      item.id,
                    )}/delete?brandId=${encodeURIComponent(selectedBrandId)}">
                      <button type="submit" class="button small secondary">Delete</button>
                    </form>
                  </td>
                </tr>`;
              })
              .join("")
          : `<tr><td colspan="8" class="muted">No schedule items yet.</td></tr>`;
    }

    const notice =
      status === "created"
        ? { type: "success" as const, text: "Schedule item created." }
        : status === "updated"
          ? { type: "success" as const, text: "Schedule item updated." }
          : status === "deleted"
            ? { type: "success" as const, text: "Schedule item deleted." }
            : undefined;

    const html = renderLayout(
      "Schedule",
      `
      <div class="card">
        <h1>Schedule</h1>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/schedule")}
        ${
          selectedBrandId
            ? `<div class="row" style="margin-top:10px;">
                <a class="button secondary small" href="/schedule.ics?brandId=${encodeURIComponent(
                  selectedBrandId,
                )}">Export Calendar (.ics)</a>
                <a class="button secondary small" href="/admin/today?brandId=${encodeURIComponent(
                  selectedBrandId,
                )}">View Today's Checklist</a>
              </div>`
            : ""
        }
      </div>

      <div class="card">
        <h2>Add Scheduled Post</h2>
        ${
          selectedBrandId
            ? `
          <form method="POST" action="/admin/schedule?brandId=${encodeURIComponent(selectedBrandId)}">
            <div class="grid">
              <div class="field"><label>Title</label><input name="title" required /></div>
              <div class="field"><label>Platform</label><select name="platform">${POST_PLATFORMS.map(
                (platform) => `<option>${platform}</option>`,
              ).join("")}</select></div>
              <div class="field"><label>Scheduled For</label><input type="datetime-local" name="scheduledFor" value="${escapeHtml(
                formatDateTimeLocalInput(nowPlusOneHour),
              )}" required /></div>
              <div class="field"><label>Status</label><select name="status">${SCHEDULE_STATUSES.map(
                (entry) => `<option ${entry === "planned" ? "selected" : ""}>${entry}</option>`,
              ).join("")}</select></div>
            </div>
            <div class="field"><label>Caption</label><textarea name="caption" required></textarea></div>
            <div class="field"><label>Asset Notes</label><textarea name="assetNotes"></textarea></div>
            <button type="submit">Save Schedule Item</button>
          </form>
          `
            : `<p>Create/select a brand first.</p>`
        }
      </div>

      <div class="card">
        <h2>Scheduled Items</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Title</th><th>Platform</th><th>Scheduled</th><th>Caption</th><th>Asset Notes</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/schedule", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Schedule", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsedPayload = scheduleCreateRequestSchema.parse({
      title: String(body.title ?? ""),
      platform: String(body.platform ?? ""),
      scheduledFor: parseLocalDateTimeToIso(body.scheduledFor),
      caption: String(body.caption ?? ""),
      assetNotes: String(body.assetNotes ?? ""),
      status: String(body.status ?? "planned"),
    });

    await adapter.addScheduleItem(userId, brandId, parsedPayload);
    return res.redirect(`/admin/schedule?brandId=${encodeURIComponent(brandId)}&status=created`);
  } catch (error) {
    return next(error);
  }
});

router.post("/schedule/:id/update", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Schedule", "<h1>Brand not found.</h1>"));
    }

    const scheduleId = req.params.id?.trim();
    if (!scheduleId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing schedule id.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updatePayload: Record<string, unknown> = {};
    if (optionalText(body.title)) {
      updatePayload.title = String(body.title);
    }
    if (optionalText(body.platform)) {
      updatePayload.platform = String(body.platform);
    }
    if (optionalText(body.scheduledFor)) {
      updatePayload.scheduledFor = parseLocalDateTimeToIso(body.scheduledFor);
    }
    if (optionalText(body.caption)) {
      updatePayload.caption = String(body.caption);
    }
    if (typeof body.assetNotes === "string") {
      updatePayload.assetNotes = body.assetNotes;
    }
    if (optionalText(body.status)) {
      updatePayload.status = scheduleStatusSchema.parse(String(body.status));
    }

    const parsedPayload = scheduleUpdateRequestSchema.parse(updatePayload);

    const updated = await adapter.updateSchedule(userId, brandId, scheduleId, parsedPayload);
    if (!updated) {
      return res.status(404).type("html").send(renderLayout("Schedule", "<h1>Schedule item not found.</h1>"));
    }

    return res.redirect(`/admin/schedule?brandId=${encodeURIComponent(brandId)}&status=updated`);
  } catch (error) {
    return next(error);
  }
});

router.post("/schedule/:id/delete", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Schedule", "<h1>Brand not found.</h1>"));
    }

    const scheduleId = req.params.id?.trim();
    if (!scheduleId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing schedule id.</h1>"));
    }

    await adapter.deleteSchedule(userId, brandId, scheduleId);
    return res.redirect(`/admin/schedule?brandId=${encodeURIComponent(brandId)}&status=deleted`);
  } catch (error) {
    return next(error);
  }
});

router.get("/today", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brands = await getAdapter().listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);

    let tasksHtml = `<p class="muted">Select a business to view today's checklist.</p>`;
    let dateLabel = "";
    if (selectedBrandId) {
      const payload = await buildTodayTasks(userId, selectedBrandId);
      dateLabel = payload.date;
      tasksHtml =
        payload.tasks.length > 0
          ? `<ul style="list-style:none; padding-left:0;">${payload.tasks
              .map(
                (task) => `<li style="margin-bottom:10px;">
                  <label style="display:flex;gap:10px;align-items:flex-start;">
                    <input type="checkbox" />
                    <span>
                      <strong>${escapeHtml(task.type.toUpperCase())}:</strong> ${escapeHtml(task.title)}
                      <div class="muted">${escapeHtml(task.notes)}</div>
                    </span>
                  </label>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="muted">No tasks generated for today.</p>`;
    }

    const html = renderLayout(
      "Today's Checklist",
      `
      <div class="card">
        <h1>Today's Checklist</h1>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/today")}
        ${
          selectedBrandId
            ? `<div class="muted" style="margin-top:8px;">Date: ${escapeHtml(dateLabel)}</div>
               <div class="row" style="margin-top:10px;">
                 <a class="button secondary small" href="/admin/schedule?brandId=${encodeURIComponent(
                   selectedBrandId,
                 )}">Open Schedule</a>
                 <a class="button secondary small" href="/schedule.ics?brandId=${encodeURIComponent(
                   selectedBrandId,
                 )}">Export Calendar (.ics)</a>
               </div>`
            : ""
        }
      </div>

      <div class="card">
        ${tasksHtml}
      </div>
      `,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/autopilot", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);
    const notice =
      status === "saved"
        ? { type: "success" as const, text: "Autopilot settings saved." }
        : status === "ran"
          ? { type: "success" as const, text: "Autopilot run completed." }
          : status === "guarded"
            ? {
                type: "error" as const,
                text: "Autopilot run was skipped by the 20-hour anti-spam guardrail.",
              }
            : status === "error"
              ? { type: "error" as const, text: "Autopilot action failed. Check server logs." }
              : undefined;

    let settingsHtml = `<p class="muted">Select a business to configure autopilot.</p>`;
    if (selectedBrandId) {
      const settings =
        (await adapter.getAutopilotSettings(userId, selectedBrandId)) ??
        (await adapter.upsertAutopilotSettings(userId, selectedBrandId, {}));
      const timezoneOptions = [...AUTOPILOT_TIMEZONES, settings.timezone]
        .filter((value, index, all) => all.indexOf(value) === index)
        .map((value) => {
          const selected = value === settings.timezone ? "selected" : "";
          return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`;
        })
        .join("");
      const goalsHtml = AUTOPILOT_GOALS.map((goal) => {
        const checked = settings.goals.includes(goal) ? "checked" : "";
        return `<label><input type="checkbox" name="goals" value="${goal}" ${checked} /> ${goal}</label>`;
      }).join("");
      const channelsHtml = AUTOPILOT_CHANNELS.map((channel) => {
        const checked = settings.channels.includes(channel) ? "checked" : "";
        return `<label><input type="checkbox" name="channels" value="${channel}" ${checked} /> ${channel}</label>`;
      }).join("");
      const cadenceOptions = ["daily", "weekday", "custom"]
        .map((cadence) => {
          const selected = settings.cadence === cadence ? "selected" : "";
          return `<option value="${cadence}" ${selected}>${cadence}</option>`;
        })
        .join("");

      settingsHtml = `
        <form method="POST" action="/admin/autopilot?brandId=${encodeURIComponent(selectedBrandId)}" class="card">
          <h2>Autopilot Settings</h2>
          <div class="grid">
            <label><input type="checkbox" name="enabled" ${settings.enabled ? "checked" : ""} /> Enabled</label>
            <label><input type="checkbox" name="allowDiscounts" ${settings.allowDiscounts ? "checked" : ""} /> Allow discounts</label>
          </div>
          <div class="grid">
            <div class="field">
              <label>Cadence</label>
              <select name="cadence">${cadenceOptions}</select>
            </div>
            <div class="field">
              <label>Hour (0-23)</label>
              <input type="number" min="0" max="23" name="hour" value="${escapeHtml(String(settings.hour))}" />
            </div>
            <div class="field">
              <label>Timezone</label>
              <select name="timezone">${timezoneOptions}</select>
            </div>
          </div>
          <div class="field">
            <label>Goals</label>
            <div class="row">${goalsHtml}</div>
          </div>
          <div class="field">
            <label>Channels</label>
            <div class="row">${channelsHtml}</div>
          </div>
          <div class="field">
            <label>Focus audiences (comma or newline separated)</label>
            <textarea name="focusAudiences">${escapeHtml(settings.focusAudiences.join("\n"))}</textarea>
          </div>
          <div class="grid">
            <div class="field">
              <label>Max discount text (optional)</label>
              <input name="maxDiscountText" value="${escapeHtml(settings.maxDiscountText ?? "")}" placeholder="$1 off max" />
            </div>
            <div class="field">
              <label>Notify email (optional)</label>
              <input type="email" name="notifyEmail" value="${escapeHtml(settings.notifyEmail ?? "")}" />
            </div>
            <div class="field">
              <label>Notify SMS (optional, +1...)</label>
              <input name="notifySms" value="${escapeHtml(settings.notifySms ?? "")}" placeholder="+16205551234" />
            </div>
          </div>
          <button type="submit">Save Autopilot Settings</button>
        </form>

        <form method="POST" action="/admin/autopilot/run?brandId=${encodeURIComponent(selectedBrandId)}" class="card">
          <h2>Run Autopilot Now</h2>
          <div class="grid">
            <div class="field">
              <label>Date (optional, defaults to tomorrow)</label>
              <input type="date" name="date" value="${escapeHtml(tomorrowDateInputValue())}" />
            </div>
            <div class="field">
              <label>Goal (optional override)</label>
              <select name="goal">
                <option value="">Use settings default</option>
                ${AUTOPILOT_GOALS.map((goal) => `<option value="${goal}">${goal}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Focus audience (optional override)</label>
              <input name="focusAudience" />
            </div>
          </div>
          <button type="submit">Run Now</button>
          <p class="muted" style="margin-top:8px;">Guardrail: max 1 run per brand within 20 hours.</p>
          <div class="row">
            <a class="button secondary small" href="/admin/tomorrow?brandId=${encodeURIComponent(
              selectedBrandId,
            )}">View Tomorrow Pack</a>
            <a class="button secondary small" href="/admin/alerts?brandId=${encodeURIComponent(
              selectedBrandId,
            )}">View Alerts</a>
          </div>
        </form>
      `;
    }

    const html = renderLayout(
      "Autopilot",
      `
      <div class="card">
        <h1>Autopilot Growth Engine</h1>
        <p class="muted">Generate tomorrow-ready assets, queue publishing jobs, and send owner notifications automatically.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/autopilot")}
      </div>
      ${settingsHtml}
      `,
      notice,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/autopilot", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res
        .status(400)
        .type("html")
        .send(renderLayout("Autopilot", "<h1>Missing brandId query parameter.</h1>"));
    }
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Autopilot", "<h1>Brand not found.</h1>"));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const payload = parseAutopilotSettingsForm(body);
    await adapter.upsertAutopilotSettings(userId, brandId, payload);
    return res.redirect(`/admin/autopilot?brandId=${encodeURIComponent(brandId)}&status=saved`);
  } catch (error) {
    return next(error);
  }
});

router.post("/autopilot/run", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res
        .status(400)
        .type("html")
        .send(renderLayout("Autopilot", "<h1>Missing brandId query parameter.</h1>"));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const payload = autopilotRunRequestSchema.parse({
      date: optionalText(body.date),
      goal: optionalText(body.goal),
      focusAudience: optionalText(body.focusAudience),
    });
    await runAutopilotForBrand({
      userId,
      brandId,
      request: payload,
      source: "api",
    });
    return res.redirect(`/admin/autopilot?brandId=${encodeURIComponent(brandId)}&status=ran`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown autopilot error";
    if (message.toLowerCase().includes("already ran")) {
      const brandId = optionalText(req.query.brandId);
      if (brandId) {
        return res.redirect(`/admin/autopilot?brandId=${encodeURIComponent(brandId)}&status=guarded`);
      }
    }
    return next(error);
  }
});

router.get("/tomorrow", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);

    let bodyHtml = `<p class="muted">Select a business to view tomorrow-ready output.</p>`;
    if (selectedBrandId) {
      const history = await adapter.listHistory(userId, selectedBrandId, 120);
      const latest = history.find((entry) => entry.endpoint === "autopilot_run");
      if (!latest) {
        bodyHtml = `<p class="muted">No autopilot output yet. Run Autopilot once to create tomorrow-ready assets.</p>`;
      } else {
        const responseRecord =
          typeof latest.response === "object" && latest.response !== null
            ? (latest.response as Record<string, unknown>)
            : {};
        const generated =
          typeof responseRecord.generated === "object" && responseRecord.generated !== null
            ? (responseRecord.generated as Record<string, unknown>)
            : responseRecord;
        const promo =
          typeof generated.promo === "object" && generated.promo !== null
            ? (generated.promo as Record<string, unknown>)
            : {};
        const post =
          typeof generated.post === "object" && generated.post !== null
            ? (generated.post as Record<string, unknown>)
            : {};
        const sms =
          typeof generated.sms === "object" && generated.sms !== null
            ? (generated.sms as Record<string, unknown>)
            : {};
        const gbp =
          typeof generated.gbp === "object" && generated.gbp !== null
            ? (generated.gbp as Record<string, unknown>)
            : {};

        bodyHtml = `
          <p class="muted">Last generated: ${escapeHtml(formatDateTime(latest.createdAt))}</p>
          <div class="grid">
            <div class="copy-item">
              <strong>Promo Sign</strong>
              <textarea id="copy-sign">${escapeHtml(String(promo.inStoreSign ?? ""))}</textarea>
              <button type="button" class="button small secondary" data-copy-target="copy-sign">Copy</button>
            </div>
            <div class="copy-item">
              <strong>Social Caption</strong>
              <textarea id="copy-caption">${escapeHtml(String(post.caption ?? ""))}</textarea>
              <button type="button" class="button small secondary" data-copy-target="copy-caption">Copy</button>
            </div>
            <div class="copy-item">
              <strong>SMS</strong>
              <textarea id="copy-sms">${escapeHtml(String(sms.message ?? ""))}</textarea>
              <button type="button" class="button small secondary" data-copy-target="copy-sms">Copy</button>
            </div>
            <div class="copy-item">
              <strong>GBP Summary</strong>
              <textarea id="copy-gbp">${escapeHtml(String(gbp.summary ?? ""))}</textarea>
              <button type="button" class="button small secondary" data-copy-target="copy-gbp">Copy</button>
            </div>
          </div>
          <div class="card">
            <h3>Raw Payload</h3>
            <pre>${escapeHtml(JSON.stringify(generated, null, 2))}</pre>
          </div>
          <script>
            document.querySelectorAll("button[data-copy-target]").forEach((button) => {
              button.addEventListener("click", async () => {
                const target = button.getAttribute("data-copy-target");
                const source = target ? document.getElementById(target) : null;
                if (!source) return;
                await navigator.clipboard.writeText(source.value || "");
                button.textContent = "Copied";
                setTimeout(() => { button.textContent = "Copy"; }, 1000);
              });
            });
          </script>
        `;
      }
    }

    const html = renderLayout(
      "Tomorrow Pack",
      `
      <div class="card">
        <h1>Tomorrow Ready Pack</h1>
        <p class="muted">Latest autopilot output for copy/paste execution.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/tomorrow")}
      </div>
      <div class="card">
        ${bodyHtml}
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/alerts", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status) === "all" ? "all" : "open";
    const flash = optionalText(req.query.flash);
    const notice =
      flash === "acked"
        ? { type: "success" as const, text: "Alert acknowledged." }
        : flash === "resolved"
          ? { type: "success" as const, text: "Alert resolved." }
          : undefined;

    let alertsHtml = `<p class="muted">Select a business to review alerts.</p>`;
    if (selectedBrandId) {
      const alerts = await adapter.listAlerts(userId, selectedBrandId, {
        status,
        limit: 120,
      });
      alertsHtml =
        alerts.length === 0
          ? `<p class="muted">No alerts for this filter.</p>`
          : alerts
              .map((alert, index) => {
                const context =
                  typeof alert.context === "object" && alert.context !== null
                    ? (alert.context as Record<string, unknown>)
                    : {};
                const recommendations =
                  typeof context.recommendations === "object" && context.recommendations !== null
                    ? (context.recommendations as Record<string, unknown>)
                    : {};
                const actions = Array.isArray(recommendations.actions)
                  ? recommendations.actions
                      .map((entry) => {
                        if (typeof entry !== "object" || entry === null) {
                          return null;
                        }
                        const row = entry as Record<string, unknown>;
                        return {
                          action: String(row.action ?? ""),
                          why: String(row.why ?? ""),
                          readyCaption: String(row.readyCaption ?? ""),
                        };
                      })
                      .filter(
                        (entry): entry is { action: string; why: string; readyCaption: string } =>
                          entry !== null,
                      )
                  : [];
                const actionHtml =
                  actions.length === 0
                    ? `<p class="muted">No recommendations attached.</p>`
                    : `<ol>${actions
                        .map(
                          (entry, actionIndex) => `<li style="margin-bottom:10px;">
                            <strong>${escapeHtml(entry.action)}</strong>
                            <div class="muted">${escapeHtml(entry.why)}</div>
                            <textarea id="alert-copy-${index}-${actionIndex}" style="width:100%; min-height:70px; margin-top:6px;">${escapeHtml(
                              entry.readyCaption,
                            )}</textarea>
                            <button type="button" class="button small secondary" data-copy-target="alert-copy-${index}-${actionIndex}">Copy caption</button>
                          </li>`,
                        )
                        .join("")}</ol>`;
                return `<div class="card">
                  <div class="row" style="justify-content:space-between;">
                    <div>
                      <h3 style="margin-bottom:6px;">${escapeHtml(alert.type)}</h3>
                      <div class="muted">${escapeHtml(alert.severity)} · ${escapeHtml(
                        formatDateTime(alert.createdAt),
                      )} · ${escapeHtml(alert.status)}</div>
                    </div>
                    <div class="row">
                      <form method="POST" action="/admin/alerts/${encodeURIComponent(
                        alert.id,
                      )}/ack?brandId=${encodeURIComponent(selectedBrandId)}">
                        <button type="submit" class="button small secondary">Acknowledge</button>
                      </form>
                      <form method="POST" action="/admin/alerts/${encodeURIComponent(
                        alert.id,
                      )}/resolve?brandId=${encodeURIComponent(selectedBrandId)}">
                        <button type="submit" class="button small">Resolve</button>
                      </form>
                    </div>
                  </div>
                  <p>${escapeHtml(alert.message)}</p>
                  ${actionHtml}
                </div>`;
              })
              .join("");
    }

    const html = renderLayout(
      "Alerts",
      `
      <div class="card">
        <h1>Alerts</h1>
        <p class="muted">Slowdown and missed-post detection with quick rescue actions.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/alerts")}
        ${
          selectedBrandId
            ? `<div class="row" style="margin-top:10px;">
                 <a class="button small secondary" href="/admin/alerts?brandId=${encodeURIComponent(
                   selectedBrandId,
                 )}&status=open">Open only</a>
                 <a class="button small secondary" href="/admin/alerts?brandId=${encodeURIComponent(
                   selectedBrandId,
                 )}&status=all">All statuses</a>
               </div>`
            : ""
        }
      </div>
      ${alertsHtml}
      <script>
        document.querySelectorAll("button[data-copy-target]").forEach((button) => {
          button.addEventListener("click", async () => {
            const target = button.getAttribute("data-copy-target");
            const source = target ? document.getElementById(target) : null;
            if (!source) return;
            await navigator.clipboard.writeText(source.value || "");
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = "Copy caption"; }, 1000);
          });
        });
      </script>
      `,
      notice,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/alerts/:id/ack", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    const alertId = req.params.id?.trim();
    if (!brandId || !alertId) {
      return res.status(400).type("html").send(renderLayout("Alerts", "<h1>Missing required parameters.</h1>"));
    }
    await adapter.updateAlert(userId, brandId, alertId, {
      status: "acknowledged",
      resolvedAt: null,
    });
    return res.redirect(`/admin/alerts?brandId=${encodeURIComponent(brandId)}&flash=acked`);
  } catch (error) {
    return next(error);
  }
});

router.post("/alerts/:id/resolve", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brandId = optionalText(req.query.brandId);
    const alertId = req.params.id?.trim();
    if (!brandId || !alertId) {
      return res.status(400).type("html").send(renderLayout("Alerts", "<h1>Missing required parameters.</h1>"));
    }
    await adapter.updateAlert(userId, brandId, alertId, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
    return res.redirect(`/admin/alerts?brandId=${encodeURIComponent(brandId)}&flash=resolved`);
  } catch (error) {
    return next(error);
  }
});

router.get("/integrations", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    let rows = `<tr><td colspan="4" class="muted">Select a business to view integration status.</td></tr>`;
    if (selectedBrandId) {
      const integrations = await adapter.listIntegrations(userId, selectedBrandId);
      const byProvider = new Map(integrations.map((entry) => [entry.provider, entry]));
      const providers: Array<{
        name: string;
        enabled: boolean;
        href: string;
      }> = [
        { name: "buffer", enabled: isBufferEnabled(), href: `/admin/integrations/buffer?brandId=${encodeURIComponent(selectedBrandId)}` },
        { name: "twilio", enabled: isTwilioEnabled(), href: `/admin/sms?brandId=${encodeURIComponent(selectedBrandId)}` },
        { name: "google_business", enabled: isGoogleBusinessEnabled(), href: `/admin/integrations/gbp?brandId=${encodeURIComponent(selectedBrandId)}` },
        { name: "sendgrid", enabled: isEmailEnabled(), href: `/admin/email?brandId=${encodeURIComponent(selectedBrandId)}` },
      ];

      rows = providers
        .map((provider) => {
          const record = byProvider.get(provider.name as (typeof integrations)[number]["provider"]);
          return `<tr>
            <td>${escapeHtml(provider.name)}</td>
            <td>${provider.enabled ? "enabled" : "disabled"}</td>
            <td>${escapeHtml(record?.status ?? "disconnected")}</td>
            <td><a class="button small secondary" href="${provider.href}">Open</a></td>
          </tr>`;
        })
        .join("");
    }

    const notice =
      status === "connected"
        ? { type: "success" as const, text: "Integration updated." }
        : status === "queued"
          ? { type: "success" as const, text: "Outbox job queued." }
          : undefined;

    const html = renderLayout(
      "Integrations",
      `
      <div class="card">
        <h1>Integrations</h1>
        <p class="muted">Connect providers and run test actions.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/integrations")}
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Provider</th><th>Flag</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      `,
      notice,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/integrations/buffer", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    const existing =
      selectedBrandId !== null
        ? await adapter.getIntegration(userId, selectedBrandId, "buffer")
        : null;
    const profiles =
      Array.isArray((existing?.config as { profiles?: unknown } | undefined)?.profiles)
        ? (((existing?.config as { profiles?: unknown[] }).profiles ?? [])
            .map((entry) => {
              if (typeof entry !== "object" || entry === null) {
                return null;
              }
              const record = entry as Record<string, unknown>;
              return {
                id: typeof record.id === "string" ? record.id : "",
                service: typeof record.service === "string" ? record.service : "",
                username:
                  typeof record.username === "string"
                    ? record.username
                    : typeof record.service_username === "string"
                      ? record.service_username
                      : "",
              };
            })
            .filter((entry): entry is { id: string; service: string; username: string } => entry !== null))
        : [];

    const notice =
      status === "connected"
        ? { type: "success" as const, text: "Buffer connected." }
        : status === "sent"
          ? { type: "success" as const, text: "Test publish sent." }
          : status === "queued"
            ? { type: "success" as const, text: "Publish queued in outbox." }
            : undefined;

    const html = renderLayout(
      "Buffer Integration",
      `
      <div class="card">
        <h1>Buffer</h1>
        <p class="muted">Flag: ${isBufferEnabled() ? "enabled" : "disabled"}</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/integrations/buffer")}
      </div>

      <div class="card">
        <h2>Connect Buffer</h2>
        ${
          selectedBrandId
            ? `<p class="muted">Use OAuth to connect Buffer channels for this brand.</p>
               <a class="button" href="/api/integrations/buffer/start?brandId=${encodeURIComponent(selectedBrandId)}">Connect Buffer</a>
               <div style="margin-top:12px;">
                 <h3 style="margin-bottom:6px;">Connected Profiles</h3>
                 ${
                   profiles.length > 0
                     ? `<table><thead><tr><th>Profile ID</th><th>Service</th><th>Username</th></tr></thead><tbody>${profiles
                         .map(
                           (profile) => `<tr><td><code>${escapeHtml(profile.id)}</code></td><td>${escapeHtml(
                             profile.service || "-",
                           )}</td><td>${escapeHtml(profile.username || "-")}</td></tr>`,
                         )
                         .join("")}</tbody></table>`
                     : `<p class="muted">No Buffer profiles saved yet.</p>`
                 }
               </div>`
            : "<p>Select a brand first.</p>"
        }
      </div>

      <div class="card">
        <h2>Test Queue Post</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/integrations/buffer/test-publish?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="grid">
                  <div class="field">
                    <label>Platform</label>
                    <select name="platform">${POST_PLATFORMS.map((entry) => `<option>${entry}</option>`).join("")}</select>
                  </div>
                  <div class="field"><label>Buffer Profile ID (optional)</label><input name="profileId" /></div>
                  <div class="field"><label>Media URL (optional)</label><input name="mediaUrl" /></div>
                  <div class="field"><label>Link URL (optional)</label><input name="linkUrl" /></div>
                  <div class="field"><label>Title (optional)</label><input name="title" /></div>
                  <div class="field"><label>Scheduled For (optional, local datetime)</label><input type="datetime-local" name="scheduledFor" /></div>
                </div>
                <div class="field"><label>Caption</label><textarea name="caption" required></textarea></div>
                <button type="submit">Queue/Publish</button>
              </form>`
            : "<p>Select a brand first.</p>"
        }
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/integrations/buffer/connect", async (req, res, next) => {
  try {
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Buffer Integration", "<h1>Missing brandId query parameter.</h1>"));
    }
    return res.redirect(`/api/integrations/buffer/start?brandId=${encodeURIComponent(brandId)}`);
  } catch (error) {
    return next(error);
  }
});

router.post("/integrations/buffer/test-publish", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Buffer Integration", "<h1>Missing brandId query parameter.</h1>"));
    }

    const adapter = getAdapter();
    const integration = await adapter.getIntegration(userId, brandId, "buffer");
    if (!integration) {
      return res.status(400).type("html").send(
        renderLayout("Buffer Integration", "<h1>Buffer integration is not connected for this brand.</h1>"),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const scheduledForInput = optionalText(body.scheduledFor);
    const scheduledFor = scheduledForInput ? parseLocalDateTimeToIso(scheduledForInput) : undefined;
    const parsed = publishRequestSchema.parse({
      platform: String(body.platform ?? ""),
      caption: String(body.caption ?? ""),
      mediaUrl: optionalText(body.mediaUrl),
      linkUrl: optionalText(body.linkUrl),
      title: optionalText(body.title),
      profileId: optionalText(body.profileId),
      scheduledFor,
      source: "manual",
    });

    const bufferProfileId = resolveBufferProfileId(integration.config, parsed.platform, parsed.profileId);
    if (!bufferProfileId) {
      return res.status(400).type("html").send(
        renderLayout(
          "Buffer Integration",
          "<h1>No Buffer profile matched this request. Connect Buffer and verify channels.</h1>",
        ),
      );
    }

    const shouldQueue =
      typeof parsed.scheduledFor === "string" && new Date(parsed.scheduledFor).getTime() > Date.now();

    const outbox = await adapter.enqueueOutbox(
      userId,
      brandId,
      "post_publish",
      {
        platform: parsed.platform,
        caption: parsed.caption,
        mediaUrl: parsed.mediaUrl,
        linkUrl: parsed.linkUrl,
        title: parsed.title,
        source: parsed.source,
        bufferProfileId,
      },
      shouldQueue ? parsed.scheduledFor : new Date().toISOString(),
    );

    if (shouldQueue) {
      await adapter.addPost(userId, brandId, {
        platform: parsed.platform,
        postedAt: parsed.scheduledFor ?? new Date().toISOString(),
        mediaType: parsed.mediaUrl ? "photo" : "text",
        captionUsed: parsed.caption,
        status: "planned",
        notes: `Queued from admin buffer test (outbox: ${outbox.id})`,
        providerMeta: {
          outboxId: outbox.id,
          bufferProfileId,
          source: parsed.source,
        },
      });
      await adapter.addHistory(userId, brandId, "publish", parsed, {
        queued: true,
        outboxId: outbox.id,
        scheduledFor: parsed.scheduledFor,
      });
      return res.redirect(`/admin/integrations/buffer?brandId=${encodeURIComponent(brandId)}&status=queued`);
    }

    await processDueOutbox({ limit: 10, types: ["post_publish"] });
    const refreshed = await adapter.getOutboxById(userId, brandId, outbox.id);
    if (refreshed?.status === "sent") {
      return res.redirect(`/admin/integrations/buffer?brandId=${encodeURIComponent(brandId)}&status=sent`);
    }

    return res.redirect(`/admin/integrations/buffer?brandId=${encodeURIComponent(brandId)}&status=queued`);
  } catch (error) {
    return next(error);
  }
});

router.get("/integrations/gbp", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    const existing =
      selectedBrandId !== null
        ? await adapter.getIntegration(userId, selectedBrandId, "google_business")
        : null;
    const locations =
      existing &&
      typeof existing.config === "object" &&
      existing.config !== null &&
      Array.isArray((existing.config as { locations?: unknown }).locations)
        ? ((existing.config as { locations: unknown[] }).locations
            .map((entry) => {
              if (typeof entry !== "object" || entry === null) {
                return null;
              }
              const row = entry as Record<string, unknown>;
              const name = typeof row.name === "string" ? row.name : "";
              if (!name) {
                return null;
              }
              return {
                name,
                title: typeof row.title === "string" ? row.title : "",
              };
            })
            .filter(
              (entry): entry is { name: string; title: string } => entry !== null,
            ) as Array<{ name: string; title: string }>)
        : [];

    const notice =
      status === "connected"
        ? { type: "success" as const, text: "Google Business connected." }
        : undefined;

    const html = renderLayout(
      "Google Business Integration",
      `
      <div class="card">
        <h1>Google Business Profile</h1>
        <p class="muted">Flag: ${isGoogleBusinessEnabled() ? "enabled" : "disabled"}</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/integrations/gbp")}
      </div>

      <div class="card">
        <h2>Connect OAuth</h2>
        ${
          selectedBrandId
            ? `<p class="muted">Connect your Google account, then select one of your business locations automatically.</p>
              <a class="button" href="/api/integrations/gbp/start?brandId=${encodeURIComponent(selectedBrandId)}">Connect Google Business</a>
              <div style="margin-top:12px;">
                <h3 style="margin-bottom:6px;">Connected Locations</h3>
                ${
                  locations.length > 0
                    ? `<table><thead><tr><th>Location Name</th><th>Title</th></tr></thead><tbody>${locations
                        .map(
                          (location) => `<tr><td><code>${escapeHtml(location.name)}</code></td><td>${escapeHtml(
                            location.title || "-",
                          )}</td></tr>`,
                        )
                        .join("")}</tbody></table>`
                    : `<p class="muted">No Google Business locations saved yet.</p>`
                }
              </div>`
            : "<p>Select a brand first.</p>"
        }
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/integrations/gbp/connect", async (req, res, next) => {
  try {
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("GBP Integration", "<h1>Missing brandId query parameter.</h1>"));
    }
    return res.redirect(`/api/integrations/gbp/start?brandId=${encodeURIComponent(brandId)}`);
  } catch (error) {
    return next(error);
  }
});

router.get("/sms", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    let contactsRows = `<tr><td colspan="6" class="muted">Select a business to manage contacts.</td></tr>`;
    let logRows = `<tr><td colspan="7" class="muted">Select a business to view SMS logs.</td></tr>`;
    if (selectedBrandId) {
      const [contacts, messages] = await Promise.all([
        adapter.listSmsContacts(userId, selectedBrandId, 200),
        adapter.listSmsMessages(userId, selectedBrandId, 100),
      ]);

      contactsRows =
        contacts.length > 0
          ? contacts
              .map(
                (contact) => `<tr>
                  <td><code>${escapeHtml(contact.id)}</code></td>
                  <td>${escapeHtml(contact.name ?? "-")}</td>
                  <td>${escapeHtml(contact.phone)}</td>
                  <td>${escapeHtml(contact.tags.join(", ") || "-")}</td>
                  <td>${contact.optedIn ? "yes" : "no"}</td>
                  <td>
                    <form method="POST" action="/admin/sms/contacts/${encodeURIComponent(contact.id)}/toggle?brandId=${encodeURIComponent(selectedBrandId)}">
                      <input type="hidden" name="optedIn" value="${contact.optedIn ? "false" : "true"}" />
                      <button class="button small secondary" type="submit">${contact.optedIn ? "Opt Out" : "Opt In"}</button>
                    </form>
                  </td>
                </tr>`,
              )
              .join("")
          : `<tr><td colspan="6" class="muted">No contacts yet.</td></tr>`;

      logRows =
        messages.length > 0
          ? messages
              .map(
                (message) => `<tr>
                  <td><code>${escapeHtml(message.id)}</code></td>
                  <td>${escapeHtml(message.toPhone)}</td>
                  <td>${escapeHtml(message.status)}</td>
                  <td>${escapeHtml(message.purpose ?? "-")}</td>
                  <td>${escapeHtml(snippet(message.body, 100))}</td>
                  <td>${escapeHtml(message.error ?? "-")}</td>
                  <td>${escapeHtml(formatDateTime(message.sentAt ?? message.createdAt))}</td>
                </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="muted">No SMS logs yet.</td></tr>`;
    }

    const notice =
      status === "sent"
        ? { type: "success" as const, text: "SMS sent." }
        : status === "queued"
          ? { type: "success" as const, text: "SMS campaign queued." }
          : status === "contact-saved"
            ? { type: "success" as const, text: "SMS contact saved." }
            : status === "contact-updated"
              ? { type: "success" as const, text: "SMS contact updated." }
              : status === "dry-run"
                ? { type: "success" as const, text: "Dry run complete. No messages queued." }
          : undefined;

    const html = renderLayout(
      "SMS",
      `
      <div class="card">
        <h1>SMS</h1>
        <p class="muted">Flag: ${isTwilioEnabled() ? "enabled" : "disabled"}</p>
        <p class="muted"><strong>Warning:</strong> SMS should only be sent to opted-in recipients. Follow local laws and carrier rules.</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/sms")}
      </div>

      <div class="card">
        <h2>Add / Upsert Contact</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/sms/contacts?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="grid">
                  <div class="field"><label>Name (optional)</label><input name="name" /></div>
                  <div class="field"><label>Phone</label><input name="phone" placeholder="(555) 555-0123" required /></div>
                  <div class="field"><label>Tags (comma separated)</label><input name="tags" placeholder="vip, teachers" /></div>
                  <div class="field"><label>Consent Source</label><input name="consentSource" placeholder="in_store" /></div>
                </div>
                <label><input type="checkbox" name="optedIn" checked /> Opted in</label>
                <div style="margin-top:10px;"><button type="submit">Save Contact</button></div>
              </form>`
            : "<p>Select a brand first.</p>"
        }
      </div>

      <div class="card">
        <h2>Contacts</h2>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Tags</th><th>Opted In</th><th>Action</th></tr></thead>
          <tbody>${contactsRows}</tbody>
        </table>
      </div>

      <div class="card">
        <h2>Send Test SMS</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/sms/send?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="grid">
                  <div class="field"><label>To (E.164)</label><input name="to" placeholder="+15555550123" required /></div>
                  <div class="field"><label>Purpose</label><select name="purpose">${["promo", "reminder", "service", "other"].map((entry) => `<option>${entry}</option>`).join("")}</select></div>
                </div>
                <div class="field"><label>Message</label><textarea name="message" required></textarea></div>
                <label><input type="checkbox" name="sendNow" checked /> Attempt immediate send</label>
                <div style="margin-top:10px;"><button type="submit">Queue SMS</button></div>
              </form>`
            : "<p>Select a brand first.</p>"
        }
      </div>

      <div class="card">
        <h2>Campaign</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/sms/campaign?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="grid">
                  <div class="field"><label>List Tag</label><select name="listTag">${["teachers", "vip", "gym", "general"].map((entry) => `<option>${entry}</option>`).join("")}</select></div>
                </div>
                <div class="field"><label>Message</label><textarea name="message" required></textarea></div>
                <label><input type="checkbox" name="dryRun" /> Dry run only (preview count)</label><br />
                <label><input type="checkbox" name="sendNow" checked /> Attempt immediate send chunk</label>
                <div style="margin-top:10px;"><button type="submit">Queue Campaign</button></div>
              </form>`
            : "<p>Select a brand first.</p>"
        }
      </div>

      <div class="card">
        <h2>SMS Logs</h2>
        <table>
          <thead><tr><th>ID</th><th>To</th><th>Status</th><th>Purpose</th><th>Body</th><th>Error</th><th>Time</th></tr></thead>
          <tbody>${logRows}</tbody>
        </table>
      </div>
      `,
      notice,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/sms/contacts", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("SMS", "<h1>Missing brandId query parameter.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const tags = String(body.tags ?? "")
      .split(/[,\n]/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    const parsed = smsContactUpsertSchema.parse({
      phone: normalizeUSPhone(String(body.phone ?? "")),
      name: optionalText(body.name),
      tags,
      optedIn: checkbox(body.optedIn),
      consentSource: optionalText(body.consentSource),
    });

    await getAdapter().upsertSmsContact(userId, brandId, parsed);
    return res.redirect(`/admin/sms?brandId=${encodeURIComponent(brandId)}&status=contact-saved`);
  } catch (error) {
    return next(error);
  }
});

router.post("/sms/contacts/:contactId/toggle", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("SMS", "<h1>Missing brandId query parameter.</h1>"));
    }
    const contactId = req.params.contactId?.trim();
    if (!contactId) {
      return res.status(400).type("html").send(renderLayout("SMS", "<h1>Missing contact id.</h1>"));
    }

    await getAdapter().updateSmsContact(userId, brandId, contactId, {
      optedIn: checkbox((req.body as Record<string, unknown> | undefined)?.optedIn),
    });
    return res.redirect(`/admin/sms?brandId=${encodeURIComponent(brandId)}&status=contact-updated`);
  } catch (error) {
    return next(error);
  }
});

router.post("/sms/send", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("SMS", "<h1>Missing brandId query parameter.</h1>"));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = smsSendRequestSchema.parse({
      to: normalizeUSPhone(String(body.to ?? "")),
      message: String(body.message ?? ""),
      purpose: String(body.purpose ?? "promo"),
      sendNow: checkbox(body.sendNow),
    });
    const adapter = getAdapter();

    await getTwilioProvider(userId, brandId);
    const existingContacts = await adapter.listSmsContacts(userId, brandId, 5000);
    const existingContact = existingContacts.find((entry) => entry.phone === parsed.to);
    if (existingContact && !existingContact.optedIn) {
      return res.status(400).type("html").send(
        renderLayout(
          "SMS",
          "<h1>Recipient is opted out. Toggle opt-in on the contact before sending.</h1>",
        ),
      );
    }

    const message = await adapter.addSmsMessage(userId, brandId, {
      toPhone: parsed.to,
      body: parsed.message,
      status: "queued",
      purpose: parsed.purpose,
    });
    await adapter.enqueueOutbox(
      userId,
      brandId,
      "sms_send",
      {
        to: parsed.to,
        body: parsed.message,
        purpose: parsed.purpose,
        smsMessageId: message.id,
      },
      new Date().toISOString(),
    );

    if (parsed.sendNow) {
      await processDueOutbox({ limit: 25, types: ["sms_send"] });
    }

    return res.redirect(`/admin/sms?brandId=${encodeURIComponent(brandId)}&status=sent`);
  } catch (error) {
    return next(error);
  }
});

router.post("/sms/campaign", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("SMS", "<h1>Missing brandId query parameter.</h1>"));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = smsCampaignRequestSchema.parse({
      listTag: String(body.listTag ?? ""),
      message: String(body.message ?? ""),
      dryRun: checkbox(body.dryRun),
      sendNow: checkbox(body.sendNow),
    });

    await getTwilioProvider(userId, brandId);
    const adapter = getAdapter();
    const contacts = await adapter.listSmsContacts(userId, brandId, 5000);
    const listTag = parsed.listTag.trim().toLowerCase();
    const selected = contacts.filter((contact) => {
      if (!contact.optedIn) {
        return false;
      }
      if (listTag === "general") {
        return true;
      }
      return contact.tags.some((tag) => tag.trim().toLowerCase() === listTag);
    });

    if (parsed.dryRun) {
      return res.redirect(`/admin/sms?brandId=${encodeURIComponent(brandId)}&status=dry-run`);
    }

    const smsMessages = await Promise.all(
      selected.map((contact) =>
        adapter.addSmsMessage(userId, brandId, {
          toPhone: contact.phone,
          body: parsed.message,
          status: "queued",
          purpose: "promo",
        }),
      ),
    );

    await adapter.enqueueOutbox(
      userId,
      brandId,
      "sms_campaign",
      {
        listTag: parsed.listTag,
        body: parsed.message,
        recipients: smsMessages.map((entry) => ({
          to: entry.toPhone,
          smsMessageId: entry.id,
        })),
      },
      new Date().toISOString(),
    );

    if (parsed.sendNow) {
      await processDueOutbox({ limit: 25, types: ["sms_campaign"] });
    }

    return res.redirect(`/admin/sms?brandId=${encodeURIComponent(brandId)}&status=queued`);
  } catch (error) {
    return next(error);
  }
});

router.get("/gbp", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    const notice =
      status === "queued"
        ? { type: "success" as const, text: "Google Business post queued." }
        : undefined;

    const html = renderLayout(
      "Google Business Post",
      `
      <div class="card">
        <h1>Google Business Post</h1>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/gbp")}
      </div>

      <div class="card">
        <h2>Create Post</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/gbp/post?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="field"><label>Summary</label><textarea name="summary" required></textarea></div>
                <div class="grid">
                  <div class="field"><label>Call-to-action URL (optional)</label><input name="callToActionUrl" /></div>
                  <div class="field"><label>Media URL (optional)</label><input name="mediaUrl" /></div>
                  <div class="field"><label>Scheduled For (optional, local datetime)</label><input type="datetime-local" name="scheduledFor" /></div>
                </div>
                <button type="submit">Queue GBP Post</button>
              </form>`
            : "<p>Select a brand first.</p>"
        }
        <p class="muted">Posts are always queued and published by /api/jobs/outbox cron.</p>
        <p class="muted">Need to connect first? <a href="/admin/integrations/gbp${selectedBrandId ? `?brandId=${encodeURIComponent(selectedBrandId)}` : ""}">Open GBP integration</a></p>
      </div>
      `,
      notice,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/gbp/post", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("GBP", "<h1>Missing brandId query parameter.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = gbpPostSchema.parse({
      summary: String(body.summary ?? ""),
      callToActionUrl: optionalText(body.callToActionUrl),
      mediaUrl: optionalText(body.mediaUrl),
      scheduledFor: optionalText(body.scheduledFor)
        ? parseLocalDateTimeToIso(String(body.scheduledFor))
        : undefined,
    });
    const adapter = getAdapter();
    const integration = await adapter.getIntegration(userId, brandId, "google_business");
    if (!integration) {
      return res.status(400).type("html").send(
        renderLayout("GBP", "<h1>Google Business integration is not connected for this brand.</h1>"),
      );
    }

    const config =
      typeof integration.config === "object" && integration.config !== null
        ? (integration.config as Record<string, unknown>)
        : {};
    const locations = Array.isArray(config.locations)
      ? config.locations
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) {
              return null;
            }
            const record = entry as Record<string, unknown>;
            const name = typeof record.name === "string" ? record.name : "";
            return name ? name : null;
          })
          .filter((entry): entry is string => entry !== null)
      : [];
    const locationName =
      locations[0] ??
      (typeof config.locationName === "string" ? config.locationName : undefined);
    if (!locationName) {
      return res.status(400).type("html").send(
        renderLayout(
          "GBP",
          "<h1>No Google Business locations were found. Reconnect GBP and grant location access.</h1>",
        ),
      );
    }

    await adapter.enqueueOutbox(
      userId,
      brandId,
      "gbp_post",
      {
        locationName,
        summary: parsed.summary,
        callToActionUrl: parsed.callToActionUrl,
        mediaUrl: parsed.mediaUrl,
      },
      parsed.scheduledFor ? new Date(parsed.scheduledFor).toISOString() : new Date().toISOString(),
    );

    return res.redirect(`/admin/gbp?brandId=${encodeURIComponent(brandId)}&status=queued`);
  } catch (error) {
    return next(error);
  }
});

router.get("/email-digest", async (req, res) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") {
      query.set(key, value);
    }
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return res.redirect(`/admin/email${suffix}`);
});

router.get("/email", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    let previewHtml = `<p class="muted">Select a business and generate a preview.</p>`;
    const previewRequested = req.query.preview === "1";
    const previewRangeDays = Number.parseInt(String(req.query.rangeDays ?? "14"), 10);
    const previewIncludeNextWeekPlan = req.query.includeNextWeekPlan !== "0";
    const previewNotes = optionalText(req.query.notes);

    let subscriptionRows = `<tr><td colspan="7" class="muted">Select a business to manage subscriptions.</td></tr>`;
    let logRows = `<tr><td colspan="7" class="muted">Select a business to view email logs.</td></tr>`;

    if (selectedBrandId) {
      const [subscriptions, logs] = await Promise.all([
        adapter.listEmailSubscriptions(userId, selectedBrandId, 200),
        adapter.listEmailLogs(userId, selectedBrandId, 100),
      ]);

      subscriptionRows =
        subscriptions.length > 0
          ? subscriptions
              .map(
                (entry) => `<tr>
                <td><code>${escapeHtml(entry.id)}</code></td>
                <td>${escapeHtml(entry.toEmail)}</td>
                <td>${escapeHtml(entry.cadence)}</td>
                <td>${entry.dayOfWeek ?? "-"}</td>
                <td>${entry.hour ?? "-"}</td>
                <td>${entry.enabled ? "yes" : "no"}</td>
                <td>
                  <form method="POST" action="/admin/email/subscriptions/${encodeURIComponent(entry.id)}/toggle?brandId=${encodeURIComponent(selectedBrandId)}" style="display:inline-block;">
                    <input type="hidden" name="enabled" value="${entry.enabled ? "false" : "true"}" />
                    <button class="button small secondary" type="submit">${entry.enabled ? "Disable" : "Enable"}</button>
                  </form>
                  <form method="POST" action="/admin/email/subscriptions/${encodeURIComponent(entry.id)}/delete?brandId=${encodeURIComponent(selectedBrandId)}" style="display:inline-block; margin-left:6px;">
                    <button class="button small secondary" type="submit">Delete</button>
                  </form>
                </td>
              </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="muted">No subscriptions yet.</td></tr>`;

      logRows =
        logs.length > 0
          ? logs
              .map(
                (entry) => `<tr>
                <td><code>${escapeHtml(entry.id)}</code></td>
                <td>${escapeHtml(entry.toEmail)}</td>
                <td>${escapeHtml(entry.subject)}</td>
                <td>${escapeHtml(entry.status)}</td>
                <td>${escapeHtml(entry.providerId ?? "-")}</td>
                <td>${escapeHtml(entry.error ?? "-")}</td>
                <td>${escapeHtml(formatDateTime(entry.sentAt ?? entry.createdAt))}</td>
              </tr>`,
              )
              .join("")
          : `<tr><td colspan="7" class="muted">No email log entries yet.</td></tr>`;
    }

    if (selectedBrandId && previewRequested) {
      const preview = await buildDigestPreview(userId, selectedBrandId, {
        cadence: req.query.cadence === "daily" ? "daily" : "weekly",
        rangeDays:
          Number.isNaN(previewRangeDays) || previewRangeDays <= 0 ? 14 : Math.min(previewRangeDays, 90),
        includeNextWeekPlan: previewIncludeNextWeekPlan,
        notes: previewNotes,
      });
      previewHtml = `<div style="border:1px solid #e5e7eb; border-radius:8px; padding:10px;">${preview.html}</div>`;
    }

    const notice =
      status === "queued"
        ? { type: "success" as const, text: "Digest job queued." }
        : status === "subscription-saved"
          ? { type: "success" as const, text: "Subscription saved." }
          : status === "subscription-updated"
            ? { type: "success" as const, text: "Subscription updated." }
            : status === "subscription-deleted"
              ? { type: "success" as const, text: "Subscription deleted." }
        : undefined;

    const html = renderLayout(
      "Email",
      `
      <div class="card">
        <h1>Email Digests</h1>
        <p class="muted">Flag: ${isEmailEnabled() ? "enabled" : "disabled"}</p>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/email")}
      </div>

      <div class="card">
        <h2>Subscriptions</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/email/subscriptions?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="grid">
                  <div class="field"><label>To Email</label><input type="email" name="toEmail" required /></div>
                  <div class="field"><label>Cadence</label><select name="cadence"><option value="weekly">weekly</option><option value="daily">daily</option></select></div>
                  <div class="field"><label>Day Of Week (0-6, weekly)</label><input type="number" min="0" max="6" name="dayOfWeek" /></div>
                  <div class="field"><label>Hour (UTC, 0-23)</label><input type="number" min="0" max="23" name="hour" value="9" /></div>
                </div>
                <label><input type="checkbox" name="enabled" checked /> Enabled</label>
                <div style="margin-top:10px;"><button type="submit">Save Subscription</button></div>
              </form>`
            : "<p>Select a brand first.</p>"
        }
        <div style="margin-top:12px;">
          <table>
            <thead><tr><th>ID</th><th>Email</th><th>Cadence</th><th>DOW</th><th>Hour (UTC)</th><th>Enabled</th><th>Actions</th></tr></thead>
            <tbody>${subscriptionRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Preview Digest</h2>
        ${
          selectedBrandId
            ? `<form method="GET" action="/admin/email">
                <input type="hidden" name="brandId" value="${escapeHtml(selectedBrandId)}" />
                <input type="hidden" name="preview" value="1" />
                <div class="grid">
                  <div class="field"><label>Cadence</label><select name="cadence"><option value="weekly">weekly</option><option value="daily">daily</option></select></div>
                  <div class="field"><label>Range Days</label><input type="number" min="1" max="90" name="rangeDays" value="14" /></div>
                </div>
                <label><input type="checkbox" name="includeNextWeekPlan" value="1" checked /> Include next week plan</label>
                <div class="field"><label>Notes (optional)</label><textarea name="notes"></textarea></div>
                <button type="submit">Generate Preview</button>
              </form>`
            : "<p>Select a brand first.</p>"
        }
        <div style="margin-top:12px;">${previewHtml}</div>
      </div>

      <div class="card">
        <h2>Send Test Digest</h2>
        ${
          selectedBrandId
            ? `<form method="POST" action="/admin/email/send?brandId=${encodeURIComponent(selectedBrandId)}">
                <div class="grid">
                  <div class="field"><label>To Email (optional)</label><input type="email" name="toEmail" /></div>
                  <div class="field"><label>Range Days</label><input type="number" min="1" max="90" name="rangeDays" value="14" /></div>
                </div>
                <label><input type="checkbox" name="includeNextWeekPlan" value="1" checked /> Include next week plan</label><br />
                <label><input type="checkbox" name="sendNow" checked /> Attempt immediate outbox processing</label>
                <div class="field"><label>Notes (optional)</label><textarea name="notes"></textarea></div>
                <button type="submit">Queue Digest Email</button>
              </form>`
            : "<p>Select a brand first.</p>"
        }
      </div>

      <div class="card">
        <h2>Recent Email Log</h2>
        <table>
          <thead><tr><th>ID</th><th>To</th><th>Subject</th><th>Status</th><th>Provider ID</th><th>Error</th><th>Time</th></tr></thead>
          <tbody>${logRows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/email/subscriptions", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Email", "<h1>Missing brandId query parameter.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = emailSubscriptionUpsertSchema.parse({
      toEmail: String(body.toEmail ?? ""),
      cadence: String(body.cadence ?? ""),
      dayOfWeek: optionalText(body.dayOfWeek) ? Number(body.dayOfWeek) : undefined,
      hour: optionalText(body.hour) ? Number(body.hour) : undefined,
      enabled: checkbox(body.enabled),
    });
    await getAdapter().upsertEmailSubscription(userId, brandId, parsed);
    return res.redirect(`/admin/email?brandId=${encodeURIComponent(brandId)}&status=subscription-saved`);
  } catch (error) {
    return next(error);
  }
});

router.post("/email/subscriptions/:id/toggle", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Email", "<h1>Missing brandId query parameter.</h1>"));
    }
    const subscriptionId = req.params.id?.trim();
    if (!subscriptionId) {
      return res.status(400).type("html").send(renderLayout("Email", "<h1>Missing subscription id.</h1>"));
    }
    const parsed = emailSubscriptionUpdateSchema.parse({
      enabled: checkbox((req.body as Record<string, unknown> | undefined)?.enabled),
    });
    await getAdapter().updateEmailSubscription(userId, brandId, subscriptionId, parsed);
    return res.redirect(`/admin/email?brandId=${encodeURIComponent(brandId)}&status=subscription-updated`);
  } catch (error) {
    return next(error);
  }
});

router.post("/email/subscriptions/:id/delete", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Email", "<h1>Missing brandId query parameter.</h1>"));
    }
    const subscriptionId = req.params.id?.trim();
    if (!subscriptionId) {
      return res.status(400).type("html").send(renderLayout("Email", "<h1>Missing subscription id.</h1>"));
    }
    await getAdapter().deleteEmailSubscription(userId, brandId, subscriptionId);
    return res.redirect(`/admin/email?brandId=${encodeURIComponent(brandId)}&status=subscription-deleted`);
  } catch (error) {
    return next(error);
  }
});

router.post("/email/send", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Email", "<h1>Missing brandId query parameter.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = emailDigestSendRequestSchema.parse({
      toEmail: optionalText(body.toEmail),
      rangeDays: optionalText(body.rangeDays) ? Number(body.rangeDays) : undefined,
      includeNextWeekPlan: checkbox(body.includeNextWeekPlan),
      notes: optionalText(body.notes),
    });

    const adapter = getAdapter();
    const subscriptions = await adapter.listEmailSubscriptions(userId, brandId, 500);
    const enabledSubscriptions = subscriptions.filter((entry) => entry.enabled);
    const recipients =
      parsed.toEmail !== undefined
        ? [
            {
              toEmail: parsed.toEmail.trim().toLowerCase(),
              cadence:
                enabledSubscriptions.find(
                  (entry) =>
                    entry.toEmail.toLowerCase() === parsed.toEmail!.trim().toLowerCase(),
                )?.cadence ?? "weekly",
              subscriptionId: enabledSubscriptions.find(
                (entry) =>
                  entry.toEmail.toLowerCase() === parsed.toEmail!.trim().toLowerCase(),
              )?.id,
            },
          ]
        : enabledSubscriptions.map((entry) => ({
            toEmail: entry.toEmail,
            cadence: entry.cadence,
            subscriptionId: entry.id,
          }));

    if (recipients.length === 0) {
      const fallbackTo = process.env.DEFAULT_DIGEST_TO?.trim().toLowerCase();
      if (!fallbackTo) {
        return res
          .status(400)
          .type("html")
          .send(
            renderLayout(
              "Email",
              "<h1>No enabled subscriptions found. Add one or set DEFAULT_DIGEST_TO.</h1>",
            ),
          );
      }
      recipients.push({ toEmail: fallbackTo, cadence: "weekly", subscriptionId: undefined });
    }

    for (const recipient of recipients) {
      const preview = await buildDigestPreview(userId, brandId, {
        cadence: recipient.cadence,
        rangeDays: parsed.rangeDays ?? 14,
        includeNextWeekPlan: parsed.includeNextWeekPlan ?? true,
        notes: parsed.notes,
      });
      const log = await adapter.addEmailLog(userId, brandId, {
        toEmail: recipient.toEmail,
        subject: preview.subject,
        status: "queued",
        subscriptionId: recipient.subscriptionId,
      });
      await adapter.enqueueOutbox(
        userId,
        brandId,
        "email_send",
        {
          toEmail: recipient.toEmail,
          subject: preview.subject,
          html: preview.html,
          textSummary: preview.textSummary,
          cadence: recipient.cadence,
          emailLogId: log.id,
          subscriptionId: recipient.subscriptionId,
        },
        new Date().toISOString(),
      );
    }

    if (checkbox(body.sendNow)) {
      await processDueOutbox({ limit: 25, types: ["email_send"] });
    }

    return res.redirect(`/admin/email?brandId=${encodeURIComponent(brandId)}&status=queued`);
  } catch (error) {
    return next(error);
  }
});

router.get("/outbox", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const adapter = getAdapter();
    const brands = await adapter.listBrands(userId);
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    let rows = `<tr><td colspan="8" class="muted">Select a business to view outbox records.</td></tr>`;
    if (selectedBrandId) {
      const records = await adapter.listOutbox(userId, selectedBrandId, 100);
      const parsedRecords = records
        .map((record) => outboxRecordSchema.safeParse(record))
        .filter((entry): entry is { success: true; data: OutboxRecord } => entry.success)
        .map((entry) => entry.data);

      rows =
        parsedRecords.length > 0
          ? parsedRecords
              .map(
                (record) => `<tr>
                  <td><code>${escapeHtml(record.id)}</code></td>
                  <td>${escapeHtml(record.type)}</td>
                  <td>${escapeHtml(record.status)}</td>
                  <td>${record.attempts}</td>
                  <td>${escapeHtml(record.scheduledFor ?? "-")}</td>
                  <td>${escapeHtml(record.lastError ?? "-")}</td>
                  <td>${escapeHtml(formatDateTime(record.createdAt))}</td>
                  <td>
                    <form method="POST" action="/admin/outbox/${encodeURIComponent(record.id)}/retry?brandId=${encodeURIComponent(selectedBrandId)}">
                      <button class="button small secondary" type="submit">Retry</button>
                    </form>
                  </td>
                </tr>`,
              )
              .join("")
          : `<tr><td colspan="8" class="muted">No outbox records yet.</td></tr>`;
    }

    const notice =
      status === "retried"
        ? { type: "success" as const, text: "Outbox item retried." }
        : undefined;

    const html = renderLayout(
      "Outbox",
      `
      <div class="card">
        <h1>Outbox</h1>
        ${renderBrandSelector(brands, selectedBrandId, "/admin/outbox")}
      </div>

      <div class="card">
        <h2>Queued / Sent / Failed</h2>
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Attempts</th><th>Scheduled</th><th>Last Error</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      `,
      notice,
    );

    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/outbox/:id/retry", async (req, res, next) => {
  try {
    const userId = req.user?.id ?? "local-dev-user";
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Outbox", "<h1>Missing brandId query parameter.</h1>"));
    }
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).type("html").send(renderLayout("Outbox", "<h1>Missing outbox id.</h1>"));
    }

    const existing = await getAdapter().getOutboxById(userId, brandId, id);
    if (!existing) {
      return res.status(404).type("html").send(renderLayout("Outbox", "<h1>Outbox record not found.</h1>"));
    }

    await getAdapter().updateOutbox(id, {
      status: "queued",
      scheduledFor: new Date().toISOString(),
      lastError: null,
    });
    await processDueOutbox({ limit: 25 });

    return res.redirect(`/admin/outbox?brandId=${encodeURIComponent(brandId)}&status=retried`);
  } catch (error) {
    return next(error);
  }
});

export default router;
