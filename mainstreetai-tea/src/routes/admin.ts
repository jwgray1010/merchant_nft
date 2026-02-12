import { randomUUID } from "node:crypto";
import { Router } from "express";
import { createBrand, getBrand, listBrands, updateBrand } from "../data/brandStore";
import { AVAILABLE_TEMPLATE_NAMES, buildBrandFromTemplate } from "../data/templateStore";
import {
  createScheduleItem,
  deleteScheduleItem,
  listScheduleItems,
  updateScheduleItem,
} from "../data/scheduleStore";
import { deleteLocalEvent, getLocalEvents, upsertLocalEvents } from "../data/localEventsStore";
import {
  brandProfileSchema,
  type BrandProfile,
  type BrandRegistryItem,
} from "../schemas/brandSchema";
import { historyRecordSchema, type HistoryRecord } from "../schemas/historySchema";
import { metricsRequestSchema, storedMetricsSchema, type StoredMetrics } from "../schemas/metricsSchema";
import { postRequestSchema, storedPostSchema, type StoredPost } from "../schemas/postSchema";
import {
  scheduleCreateRequestSchema,
  scheduleStatusSchema,
  scheduleUpdateRequestSchema,
} from "../schemas/scheduleSchema";
import { buildTodayTasks } from "../services/todayService";
import { localJsonStore } from "../storage/localJsonStore";

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

const POST_PLATFORMS = ["facebook", "instagram", "tiktok", "other"] as const;
const POST_MEDIA_TYPES = ["photo", "reel", "story", "text"] as const;
const METRIC_WINDOWS = ["24h", "48h", "7d"] as const;
const SCHEDULE_STATUSES = ["planned", "posted", "skipped"] as const;

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
        <a class="button secondary small" href="/admin">Home</a>
        <a class="button secondary small" href="/admin/brands">Brands</a>
        <a class="button secondary small" href="/admin/schedule">Schedule</a>
        <a class="button secondary small" href="/admin/local-events">Local Events</a>
        <a class="button secondary small" href="/admin/today">Today</a>
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

  const typeOptions = BUSINESS_TYPES.map((typeValue) => {
    const selected = brand?.type === typeValue ? "selected" : "";
    return `<option value="${typeValue}" ${selected}>${typeValue}</option>`;
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

function parseBrandForm(body: Record<string, unknown>): BrandProfile {
  return brandProfileSchema.parse({
    brandId: String(body.brandId ?? "")
      .trim()
      .toLowerCase(),
    businessName: String(body.businessName ?? "").trim(),
    location: String(body.location ?? "").trim(),
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
  });
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

router.get("/", async (req, res, next) => {
  try {
    const brands = await listBrands();
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);

    let historyRows = `<tr><td colspan="5" class="muted">Select a business to see history.</td></tr>`;
    if (selectedBrandId) {
      const records = await localJsonStore.listBrandRecords<unknown>({
        collection: "history",
        brandId: selectedBrandId,
        limit: 10,
      });

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
        <a class="button" href="/admin/generate/week-plan?brandId=${encodeURIComponent(selectedBrandId)}">Week Plan</a>
        <a class="button" href="/admin/generate/next-week-plan?brandId=${encodeURIComponent(selectedBrandId)}">Next Week Plan</a>
      </div>
      <div class="row" style="margin-top: 10px;">
        <a class="button secondary" href="/admin/posts?brandId=${encodeURIComponent(selectedBrandId)}">Posting Log</a>
        <a class="button secondary" href="/admin/metrics?brandId=${encodeURIComponent(selectedBrandId)}">Metrics Log</a>
        <a class="button secondary" href="/admin/schedule?brandId=${encodeURIComponent(selectedBrandId)}">Schedule</a>
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
    const brands = await listBrands();
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseBrandForm(body);
    const created = await createBrand(parsed);
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = await buildBrandFromTemplate({
      brandId: String(body.brandId ?? "")
        .trim()
        .toLowerCase(),
      businessName: String(body.businessName ?? "").trim(),
      location: String(body.location ?? "").trim(),
      template: String(body.template ?? "") as (typeof AVAILABLE_TEMPLATE_NAMES)[number],
    });

    const created = await createBrand(profile);
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
    const brand = await getBrand(req.params.brandId);
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    body.brandId = req.params.brandId;
    const parsed = parseBrandForm(body);
    const updated = await updateBrand(req.params.brandId, parsed);
    if (!updated) {
      return res.status(404).type("html").send(renderLayout("Brand Not Found", "<h1>Brand not found.</h1>"));
    }
    return res.redirect("/admin/brands?status=updated");
  } catch (error) {
    const existing = await getBrand(req.params.brandId);
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
    const brands = await listBrands();
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
    const brands = await listBrands();
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const saved = optionalText(req.query.saved);

    let rows = `<tr><td colspan="7" class="muted">Select a business to view post logs.</td></tr>`;
    if (selectedBrandId) {
      const records = await localJsonStore.listBrandRecords<unknown>({
        collection: "posts",
        brandId: selectedBrandId,
        limit: 20,
      });
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Posting Log", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
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

    const createdAt = new Date().toISOString();
    const id = randomUUID();
    await localJsonStore.saveBrandRecord({
      collection: "posts",
      brandId,
      fileSuffix: "post",
      record: storedPostSchema.parse({
        id,
        brandId,
        createdAt,
        ...parsedRequest,
      }),
    });

    return res.redirect(`/admin/posts?brandId=${encodeURIComponent(brandId)}&saved=1`);
  } catch (error) {
    return next(error);
  }
});

router.get("/metrics", async (req, res, next) => {
  try {
    const brands = await listBrands();
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const saved = optionalText(req.query.saved);

    let rows = `<tr><td colspan="10" class="muted">Select a business to view metric logs.</td></tr>`;
    if (selectedBrandId) {
      const records = await localJsonStore.listBrandRecords<unknown>({
        collection: "metrics",
        brandId: selectedBrandId,
        limit: 20,
      });
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Metrics Log", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
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

    const createdAt = new Date().toISOString();
    const id = randomUUID();
    await localJsonStore.saveBrandRecord({
      collection: "metrics",
      brandId,
      fileSuffix: "metrics",
      record: storedMetricsSchema.parse({
        id,
        brandId,
        createdAt,
        ...parsedRequest,
      }),
    });

    return res.redirect(`/admin/metrics?brandId=${encodeURIComponent(brandId)}&saved=1`);
  } catch (error) {
    return next(error);
  }
});

router.get("/local-events", async (req, res, next) => {
  try {
    const brands = await listBrands();
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    let recurringRows = `<tr><td colspan="6" class="muted">Select a business to manage local events.</td></tr>`;
    let oneOffRows = `<tr><td colspan="7" class="muted">Select a business to manage local events.</td></tr>`;

    if (selectedBrandId) {
      const events = await getLocalEvents(selectedBrandId);
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    await upsertLocalEvents(brandId, {
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    await upsertLocalEvents(brandId, {
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = JSON.parse(String(body.eventsJson ?? "{}")) as {
      recurring?: Array<{ name: string; pattern: string; audience: string; notes?: string }>;
      oneOff?: Array<{ name: string; date: string; time?: string; audience: string; notes?: string }>;
    };

    await upsertLocalEvents(brandId, {
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Local Events", "<h1>Brand not found.</h1>"));
    }

    const eventId = req.params.eventId?.trim();
    if (!eventId) {
      return res.status(400).type("html").send(renderLayout("Local Events", "<h1>Missing event id.</h1>"));
    }

    await deleteLocalEvent(brandId, eventId);
    return res.redirect(`/admin/local-events?brandId=${encodeURIComponent(brandId)}&status=deleted`);
  } catch (error) {
    return next(error);
  }
});

router.get("/schedule", async (req, res, next) => {
  try {
    const brands = await listBrands();
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);
    const status = optionalText(req.query.status);

    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    let rows = `<tr><td colspan="8" class="muted">Select a business to view schedule items.</td></tr>`;

    if (selectedBrandId) {
      const items = await listScheduleItems(selectedBrandId);
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
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

    await createScheduleItem(brandId, parsedPayload);
    return res.redirect(`/admin/schedule?brandId=${encodeURIComponent(brandId)}&status=created`);
  } catch (error) {
    return next(error);
  }
});

router.post("/schedule/:id/update", async (req, res, next) => {
  try {
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
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

    const updated = await updateScheduleItem(brandId, scheduleId, parsedPayload);
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
    const brandId = optionalText(req.query.brandId);
    if (!brandId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing brandId query parameter.</h1>"));
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).type("html").send(renderLayout("Schedule", "<h1>Brand not found.</h1>"));
    }

    const scheduleId = req.params.id?.trim();
    if (!scheduleId) {
      return res.status(400).type("html").send(renderLayout("Schedule", "<h1>Missing schedule id.</h1>"));
    }

    await deleteScheduleItem(brandId, scheduleId);
    return res.redirect(`/admin/schedule?brandId=${encodeURIComponent(brandId)}&status=deleted`);
  } catch (error) {
    return next(error);
  }
});

router.get("/today", async (req, res, next) => {
  try {
    const brands = await listBrands();
    const selectedBrandId = selectedBrandIdFromQuery(brands, req.query.brandId);

    let tasksHtml = `<p class="muted">Select a business to view today's checklist.</p>`;
    let dateLabel = "";
    if (selectedBrandId) {
      const payload = await buildTodayTasks(selectedBrandId);
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

export default router;
