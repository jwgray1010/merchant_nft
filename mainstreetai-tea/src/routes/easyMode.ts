import { Router, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { requirePlan } from "../billing/requirePlan";
import { resolveBrandAccess } from "../auth/brandAccess";
import { getStorageMode, getAdapter } from "../storage/getAdapter";
import { extractAuthToken, resolveAuthUser } from "../supabase/verifyAuth";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import {
  dailyCheckinStatus,
  getLatestDailyPack,
  runDailyOneButton,
  submitDailyCheckin,
} from "../services/dailyOneButtonService";
import { listLocations } from "../services/locationStore";
import {
  getTownMapForUser,
  getTownMembershipForBrand,
  suggestTownFromLocation,
  updateTownMembershipForBrand,
} from "../services/townModeService";
import {
  getTownGraph,
  listPreferredPartnerCategoriesForBrand,
  recordManualCategoryPreferencesForBrand,
  townGraphCategoryFromBrandType,
  townGraphCategoryLabel,
} from "../services/townGraphService";
import { parseTownWindowOverride, townWindowLabel } from "../town/windows";
import { getTownPulseModelForBrand } from "../services/townPulseService";
import { getLatestTownStoryForBrand } from "../services/townStoriesService";
import { getTimingModel } from "../services/timingStore";
import { buildTodayTasks } from "../services/todayService";
import type { BrandProfile } from "../schemas/brandSchema";
import { townGraphCategorySchema, type TownGraphCategory } from "../schemas/townGraphSchema";
import type { LocationRecord } from "../schemas/locationSchema";
import type { AutopilotSettings } from "../schemas/autopilotSettingsSchema";
import type { AutopilotDailyOutput } from "../schemas/autopilotRunSchema";
import type { DailyOutput } from "../schemas/dailyOneButtonSchema";

const router = Router();

type BrandSummary = {
  brandId: string;
  businessName: string;
  location: string;
  type: string;
};

type EasyContext = {
  actorUserId: string;
  ownerUserId: string | null;
  role: "owner" | "admin" | "member";
  brands: BrandSummary[];
  selectedBrandId: string | null;
  selectedBrand: BrandProfile | null;
  locations: LocationRecord[];
  selectedLocationId?: string;
  selectedLocation: LocationRecord | null;
  autopilotSettings: AutopilotSettings | null;
  defaultAudience: string;
  defaultGoal: "new_customers" | "repeat_customers" | "slow_hours";
  bestPostTimeLabel: string;
};

const GRAPH_CATEGORY_OPTIONS = [...townGraphCategorySchema.options] as TownGraphCategory[];

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

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) {
    return {};
  }
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce(
      (acc, entry) => {
        const [name, ...rest] = entry.split("=");
        if (name) {
          acc[name] = decodeURIComponent(rest.join("="));
        }
        return acc;
      },
      {} as Record<string, string>,
    );
}

function setCookie(res: Response, name: string, value: string): void {
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax`,
  );
}

function clearCookie(res: Response, name: string): void {
  res.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax`);
}

function selectedFrom(
  queryValue: string | undefined,
  cookieValue: string | undefined,
  options: string[],
): string | undefined {
  if (queryValue && options.includes(queryValue)) {
    return queryValue;
  }
  if (cookieValue && options.includes(cookieValue)) {
    return cookieValue;
  }
  return options[0];
}

async function listAccessibleBrands(actorUserId: string): Promise<BrandSummary[]> {
  const adapter = getAdapter();
  if (getStorageMode() === "local") {
    const brands = await adapter.listBrands(actorUserId);
    return brands.map((brand) => ({
      brandId: brand.brandId,
      businessName: brand.businessName,
      location: brand.location,
      type: brand.type,
    }));
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const [owned, team] = await Promise.all([
    table("brands")
      .select("brand_id, business_name, location, type")
      .eq("owner_id", actorUserId),
    table("team_members")
      .select("brands!inner(brand_id, business_name, location, type)")
      .eq("user_id", actorUserId),
  ]);

  if (owned.error) {
    throw owned.error;
  }
  if (team.error) {
    throw team.error;
  }

  const merged = new Map<string, BrandSummary>();
  for (const row of (owned.data ?? []) as Array<Record<string, unknown>>) {
    const brandId = typeof row.brand_id === "string" ? row.brand_id : "";
    if (!brandId) {
      continue;
    }
    merged.set(brandId, {
      brandId,
      businessName: typeof row.business_name === "string" ? row.business_name : brandId,
      location: typeof row.location === "string" ? row.location : "",
      type: typeof row.type === "string" ? row.type : "other",
    });
  }
  for (const row of (team.data ?? []) as Array<Record<string, unknown>>) {
    const brands = row.brands as Record<string, unknown> | null;
    const brandId = typeof brands?.brand_id === "string" ? brands.brand_id : "";
    if (!brandId || merged.has(brandId)) {
      continue;
    }
    merged.set(brandId, {
      brandId,
      businessName: typeof brands?.business_name === "string" ? brands.business_name : brandId,
      location: typeof brands?.location === "string" ? brands.location : "",
      type: typeof brands?.type === "string" ? brands.type : "other",
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.businessName.localeCompare(b.businessName));
}

function withSelection(
  path: string,
  context: EasyContext,
  extras?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (context.selectedBrandId) {
    params.set("brandId", context.selectedBrandId);
  }
  if (context.selectedLocationId) {
    params.set("locationId", context.selectedLocationId);
  }
  for (const [key, value] of Object.entries(extras ?? {})) {
    if (typeof value === "string" && value !== "") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function withNotice(url: string, notice: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}notice=${encodeURIComponent(notice)}`;
}

async function resolveContext(req: Request, res: Response): Promise<EasyContext | null> {
  const token = extractAuthToken(req);
  if (!token) {
    res.redirect("/admin/login");
    return null;
  }
  const authUser = await resolveAuthUser(token);
  if (!authUser?.id) {
    res.redirect("/admin/login");
    return null;
  }
  req.user = authUser;

  const brands = await listAccessibleBrands(authUser.id);
  const cookies = parseCookies(req);
  const queryBrandId = optionalText(req.query.brandId);
  const selectedBrandId = selectedFrom(queryBrandId, cookies.msai_easy_brand, brands.map((b) => b.brandId));
  if (selectedBrandId) {
    setCookie(res, "msai_easy_brand", selectedBrandId);
  }

  if (!selectedBrandId) {
    return {
      actorUserId: authUser.id,
      ownerUserId: null,
      role: "owner",
      brands,
      selectedBrandId: null,
      selectedBrand: null,
      locations: [],
      selectedLocation: null,
      autopilotSettings: null,
      defaultAudience: "general",
      defaultGoal: "repeat_customers",
      bestPostTimeLabel: "3:00 PM",
    };
  }

  const access = await resolveBrandAccess(authUser.id, selectedBrandId);
  if (!access) {
    return {
      actorUserId: authUser.id,
      ownerUserId: null,
      role: "owner",
      brands,
      selectedBrandId: null,
      selectedBrand: null,
      locations: [],
      selectedLocation: null,
      autopilotSettings: null,
      defaultAudience: "general",
      defaultGoal: "repeat_customers",
      bestPostTimeLabel: "3:00 PM",
    };
  }
  req.brandAccess = access;
  req.user = {
    ...(req.user ?? { email: null }),
    id: access.ownerId,
    actorId: authUser.id,
    brandRole: access.role,
  };

  const adapter = getAdapter();
  const brand = await adapter.getBrand(access.ownerId, access.brandId);
  if (!brand) {
    return {
      actorUserId: authUser.id,
      ownerUserId: access.ownerId,
      role: access.role,
      brands,
      selectedBrandId: null,
      selectedBrand: null,
      locations: [],
      selectedLocation: null,
      autopilotSettings: null,
      defaultAudience: "general",
      defaultGoal: "repeat_customers",
      bestPostTimeLabel: "3:00 PM",
    };
  }

  const [locations, autopilotSettings, timingModel] = await Promise.all([
    listLocations(access.ownerId, access.brandId).catch(() => []),
    adapter.getAutopilotSettings(access.ownerId, access.brandId).catch(() => null),
    getTimingModel(access.ownerId, access.brandId, "instagram").catch(() => null),
  ]);
  const rawLocationQuery = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const queryLocationId = rawLocationQuery?.trim();
  const locationIds = locations.map((location) => location.id);
  const selectedLocationId = selectedFrom(
    queryLocationId && queryLocationId !== "" ? queryLocationId : undefined,
    cookies.msai_easy_location,
    locationIds,
  );
  if (rawLocationQuery !== undefined && queryLocationId === "") {
    clearCookie(res, "msai_easy_location");
  } else if (selectedLocationId) {
    setCookie(res, "msai_easy_location", selectedLocationId);
  }
  const selectedLocation = selectedLocationId
    ? locations.find((location) => location.id === selectedLocationId) ?? null
    : null;
  const defaultAudience =
    autopilotSettings?.focusAudiences[0] ?? brand.audiences[0] ?? "general";
  const defaultGoal = (autopilotSettings?.goals[0] ?? "repeat_customers") as
    | "new_customers"
    | "repeat_customers"
    | "slow_hours";
  const bestPostTimeLabel =
    timingModel?.model.bestTimeLabel ??
    `${String(autopilotSettings?.hour ?? 15).padStart(2, "0")}:00`;

  return {
    actorUserId: authUser.id,
    ownerUserId: access.ownerId,
    role: access.role,
    brands,
    selectedBrandId: access.brandId,
    selectedBrand: brand,
    locations,
    selectedLocationId,
    selectedLocation,
    autopilotSettings,
    defaultAudience,
    defaultGoal,
    bestPostTimeLabel,
  };
}

function renderBottomNav(context: EasyContext, active: "home" | "create" | "analyze" | "schedule" | "settings"): string {
  const baseEntries = [
    { key: "home", icon: "🏠", href: withSelection("/app", context), label: "Home" },
    { key: "create", icon: "✨", href: withSelection("/app/create", context), label: "Create" },
    { key: "analyze", icon: "🔎", href: withSelection("/app/analyze", context), label: "Analyze" },
    { key: "schedule", icon: "📅", href: withSelection("/app/schedule", context), label: "Schedule" },
    { key: "settings", icon: "⚙️", href: withSelection("/app/settings", context), label: "Settings" },
  ] as const;
  const entries =
    context.role === "member"
      ? baseEntries.filter((entry) => entry.key !== "settings")
      : baseEntries;
  return `<nav class="bottom-nav" style="grid-template-columns: repeat(${entries.length}, 1fr);">
    ${entries
      .map((entry) => {
        const activeClass = entry.key === active ? "active" : "";
        return `<a class="nav-item ${activeClass}" href="${escapeHtml(entry.href)}" aria-label="${escapeHtml(
          entry.label,
        )}" title="${escapeHtml(entry.label)}"><span>${entry.icon}</span></a>`;
      })
      .join("")}
  </nav>`;
}

function renderHeader(context: EasyContext, currentPath: string): string {
  if (!context.selectedBrandId || !context.selectedBrand) {
    return `<div class="rounded-2xl p-6 shadow-sm bg-white">
      <h1 class="text-xl">Welcome to MainStreetAI Easy Mode</h1>
      <p class="muted">Create your first business profile in quick onboarding.</p>
      <a class="primary-button" href="/onboarding">Start onboarding</a>
    </div>`;
  }
  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";
  const brandOptions = context.brands
    .map((brand) => {
      const selected = brand.brandId === context.selectedBrandId ? "selected" : "";
      return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
        brand.businessName,
      )}</option>`;
    })
    .join("");
  const locationOptions = [
    `<option value="">All locations</option>`,
    ...context.locations.map((location) => {
      const selected = location.id === context.selectedLocationId ? "selected" : "";
      return `<option value="${escapeHtml(location.id)}" ${selected}>${escapeHtml(location.name)}</option>`;
    }),
  ].join("");
  return `<header class="rounded-2xl p-6 shadow-sm bg-white">
    <p class="muted">${escapeHtml(greeting)}, ${escapeHtml(context.selectedBrand.businessName)}</p>
    <h1 class="text-xl">${escapeHtml(context.selectedBrand.businessName)}</h1>
    <p class="muted">${escapeHtml(context.selectedBrand.location)}</p>
    <form method="GET" action="${escapeHtml(currentPath)}" class="selector-grid">
      ${
        context.brands.length > 1
          ? `<label class="field-label">Business
              <select name="brandId" onchange="this.form.submit()">${brandOptions}</select>
            </label>`
          : `<input type="hidden" name="brandId" value="${escapeHtml(context.selectedBrand.brandId)}" />`
      }
      <label class="field-label">Location
        <select name="locationId" onchange="this.form.submit()">${locationOptions}</select>
      </label>
      <noscript><button class="secondary-button" type="submit">Apply</button></noscript>
    </form>
  </header>`;
}

function renderCoachBubble(context: EasyContext): string {
  return `<button id="coach-open" class="coach-fab" type="button">💬</button>
  <div id="coach-modal" class="coach-modal hidden">
    <div class="coach-card rounded-2xl p-6 shadow-sm bg-white">
      <h3>Need an idea today?</h3>
      <p class="muted">Pick one quick action:</p>
      <a class="primary-button" href="${escapeHtml(withSelection("/app/post-now", context))}">⚡ Post Now?</a>
      <button class="primary-button" id="coach-run-daily" type="button">✅ Make Me Money Today</button>
      <a class="secondary-button" href="#" id="coach-close">Close</a>
    </div>
  </div>`;
}

function easyLayout(input: {
  title: string;
  context: EasyContext;
  active: "home" | "create" | "analyze" | "schedule" | "settings";
  currentPath: string;
  body: string;
  notice?: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(input.title)} · MainStreetAI Easy Mode</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; color: #111827; padding-bottom: 92px; }
      .app-wrap { max-width: 760px; margin: 0 auto; padding: 14px; display: grid; gap: 12px; }
      .rounded-2xl { border-radius: 1rem; }
      .rounded-xl { border-radius: 0.8rem; }
      .p-6 { padding: 1.5rem; }
      .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
      .shadow-sm { box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
      .bg-white { background: #fff; }
      .text-lg { font-size: 1.1rem; }
      .text-xl { font-size: 1.35rem; margin: 0 0 2px 0; }
      .font-semibold { font-weight: 600; }
      .w-full { width: 100%; box-sizing: border-box; }
      .muted { color: #6b7280; font-size: 0.9rem; margin: 0; }
      .grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .action-card { text-decoration: none; color: inherit; border: 1px solid #e5e7eb; display: block; min-height: 120px; }
      .action-card .emoji { font-size: 1.6rem; display: block; margin-bottom: 8px; }
      .selector-grid { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; margin-top: 12px; }
      .field-label { display: grid; gap: 6px; font-size: 0.9rem; color: #374151; }
      input, textarea, select { border: 1px solid #d1d5db; border-radius: 0.8rem; padding: 0.75rem; font-size: 1rem; width: 100%; box-sizing: border-box; background: #fff; }
      textarea { min-height: 108px; resize: vertical; }
      .primary-button { display: inline-block; text-align: center; background: #2563eb; color: white; text-decoration: none; border: none; cursor: pointer; }
      .secondary-button { display: inline-block; text-align: center; background: #fff; color: #1f2937; border: 1px solid #d1d5db; text-decoration: none; cursor: pointer; }
      .primary-button, .secondary-button { width: 100%; font-size: 1.06rem; padding: 1rem; border-radius: 0.8rem; font-weight: 600; box-sizing: border-box; }
      .output-card { border: 1px solid #e5e7eb; border-radius: 0.9rem; padding: 12px; margin-top: 10px; background: #fff; }
      .output-label { font-size: 0.86rem; color: #6b7280; margin-bottom: 6px; }
      .output-value { white-space: pre-wrap; font-size: 1rem; margin: 0 0 8px 0; }
      .copy-button { border: 1px solid #d1d5db; background: #fff; border-radius: 10px; padding: 8px 10px; }
      .list { margin: 0; padding-left: 18px; }
      .status-good { color: #166534; font-weight: 700; }
      .status-wait { color: #92400e; font-weight: 700; }
      .bottom-nav { position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; width: min(760px, 100%); background: #fff; border-top: 1px solid #e5e7eb; display: grid; grid-template-columns: repeat(5, 1fr); padding: 8px 0; z-index: 40; }
      .nav-item { text-decoration: none; color: #6b7280; font-size: 1.7rem; display: grid; place-items: center; min-height: 52px; }
      .nav-item.active { color: #2563eb; }
      .coach-fab { position: fixed; right: 16px; bottom: 84px; border: none; background: #111827; color: #fff; width: 58px; height: 58px; border-radius: 999px; font-size: 1.4rem; box-shadow: 0 5px 16px rgba(0,0,0,0.25); z-index: 45; }
      .coach-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: end center; padding: 14px; z-index: 50; }
      .coach-modal.hidden { display: none; }
      .coach-card { width: min(520px, 100%); display: grid; gap: 8px; }
      .notice { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 0.9rem; padding: 10px; color: #1e3a8a; }
      .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      @media (max-width: 560px) {
        .grid { grid-template-columns: 1fr; }
        .selector-grid { grid-template-columns: 1fr; }
        .two-col { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="app-wrap">
      ${renderHeader(input.context, input.currentPath)}
      ${input.notice ? `<div class="notice">${escapeHtml(input.notice)}</div>` : ""}
      ${input.body}
    </main>
    ${renderBottomNav(input.context, input.active)}
    ${renderCoachBubble(input.context)}
    <script>
      function setupCopyButtons() {
        document.querySelectorAll("[data-copy-target]").forEach((button) => {
          if (button.dataset.copyBound === "1") {
            return;
          }
          button.dataset.copyBound = "1";
          if (!button.dataset.copyLabel) {
            button.dataset.copyLabel = button.textContent || "Copy";
          }
          button.addEventListener("click", async () => {
            const targetId = button.getAttribute("data-copy-target");
            const target = targetId ? document.getElementById(targetId) : null;
            if (!target) return;
            const text = target.value || target.textContent || "";
            await navigator.clipboard.writeText(text);
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = button.dataset.copyLabel || "Copy"; }, 1000);
          });
        });
        document.querySelectorAll(".add-town-story-btn").forEach((button) => {
          if (button.dataset.bound === "1") {
            return;
          }
          button.dataset.bound = "1";
          button.addEventListener("click", () => {
            const caption = document.getElementById("daily-caption");
            const addOn = document.getElementById("daily-town-story-caption");
            const addOnText = addOn?.textContent?.trim() || "";
            if (!caption || !addOnText) {
              return;
            }
            const current = caption.textContent?.trim() || "";
            if (current.includes(addOnText)) {
              return;
            }
            caption.textContent = current ? current + "\\n\\n" + addOnText : addOnText;
            button.textContent = "Added";
          });
        });
      }
      setupCopyButtons();
      window.__setupCopyButtons = setupCopyButtons;
      const coachOpen = document.getElementById("coach-open");
      const coachModal = document.getElementById("coach-modal");
      const coachClose = document.getElementById("coach-close");
      const coachRunDaily = document.getElementById("coach-run-daily");
      coachOpen?.addEventListener("click", () => coachModal?.classList.remove("hidden"));
      coachClose?.addEventListener("click", (event) => { event.preventDefault(); coachModal?.classList.add("hidden"); });
      coachRunDaily?.addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.pathname = "/app";
        url.searchParams.set("runDaily", "1");
        window.location.href = url.toString();
      });
      coachModal?.addEventListener("click", (event) => {
        if (event.target === coachModal) coachModal.classList.add("hidden");
      });
    </script>
  </body>
</html>`;
}

function cardLink(href: string, emoji: string, title: string, subtitle: string): string {
  return `<a class="action-card rounded-2xl p-6 shadow-sm bg-white" href="${escapeHtml(href)}">
    <span class="emoji">${emoji}</span>
    <strong>${escapeHtml(title)}</strong>
    <p class="muted" style="margin-top:8px;">${escapeHtml(subtitle)}</p>
  </a>`;
}

async function latestTomorrowPack(
  ownerUserId: string,
  brandId: string,
): Promise<{ output: AutopilotDailyOutput; createdAt: string } | null> {
  const history = await getAdapter().listHistory(ownerUserId, brandId, 150);
  for (const entry of history) {
    if (entry.endpoint !== "autopilot_run") {
      continue;
    }
    const response = entry.response as Record<string, unknown> | null;
    if (
      response &&
      typeof response === "object" &&
      typeof response.generated === "object" &&
      response.generated !== null
    ) {
      const generated = response.generated as AutopilotDailyOutput;
      if (generated?.promo?.promoName && generated?.post?.caption) {
        return { output: generated, createdAt: entry.createdAt };
      }
    }
  }
  return null;
}

async function smsSuggestion(ownerUserId: string, brandId: string): Promise<string> {
  const history = await getAdapter().listHistory(ownerUserId, brandId, 60);
  for (const entry of history) {
    if (entry.endpoint === "promo") {
      const response = entry.response as Record<string, unknown> | null;
      if (response && typeof response.smsText === "string" && response.smsText.trim() !== "") {
        return response.smsText.trim();
      }
    }
    if (entry.endpoint === "autopilot_run") {
      const response = entry.response as Record<string, unknown> | null;
      const generated =
        response && typeof response.generated === "object" ? (response.generated as Record<string, unknown>) : null;
      const sms = generated?.sms as Record<string, unknown> | undefined;
      if (sms && typeof sms.message === "string" && sms.message.trim() !== "") {
        return sms.message.trim();
      }
    }
  }
  return "Hey! We have fresh specials today. Stop by and see what’s new.";
}

function renderDailyPackSection(pack: DailyOutput, signUrl: string): string {
  const localBoostSection = pack.localBoost
    ? `<details class="output-card">
        <summary><strong>Local Boost</strong></summary>
        <p class="output-value" style="margin-top:8px;"><strong>${escapeHtml(pack.localBoost.line)}</strong></p>
        <p id="daily-local-caption-addon" class="output-value">${escapeHtml(pack.localBoost.captionAddOn)}</p>
        <p id="daily-local-staff-line" class="output-value">${escapeHtml(pack.localBoost.staffScript)}</p>
      </details>`
    : "";
  const townBoostSection = pack.townBoost
    ? `<details class="output-card">
        <summary><strong>Town Boost</strong></summary>
        <p class="output-value" style="margin-top:8px;"><strong>${escapeHtml(pack.townBoost.line)}</strong></p>
        <p id="daily-town-caption-addon" class="output-value">${escapeHtml(pack.townBoost.captionAddOn)}</p>
        <p id="daily-town-staff-line" class="output-value">${escapeHtml(pack.townBoost.staffScript)}</p>
      </details>`
    : "";
  const townStorySection = pack.townStory
    ? `<details class="output-card">
        <summary><strong>Town Story (optional)</strong></summary>
        <p class="output-value" style="margin-top:8px;"><strong>${escapeHtml(pack.townStory.headline)}</strong></p>
        <p id="daily-town-story-caption" class="output-value">${escapeHtml(pack.townStory.captionAddOn)}</p>
        <p id="daily-town-story-staff-line" class="output-value">${escapeHtml(pack.townStory.staffLine)}</p>
      </details>`
    : "";
  const townGraphSection = pack.townGraphBoost
    ? `<details class="output-card">
        <summary><strong>Town Graph Boost (optional)</strong></summary>
        <p class="output-value" style="margin-top:8px;"><strong>${escapeHtml(pack.townGraphBoost.nextStopIdea)}</strong></p>
        <p id="daily-town-graph-caption" class="output-value">${escapeHtml(pack.townGraphBoost.captionAddOn)}</p>
        <p id="daily-town-graph-staff-line" class="output-value">${escapeHtml(pack.townGraphBoost.staffLine)}</p>
      </details>`
    : "";
  const townMicroRouteSection = pack.townMicroRoute
    ? `<details class="output-card">
        <summary><strong>Town Route Tip (${escapeHtml(townWindowLabel(pack.townMicroRoute.window))})</strong></summary>
        <p class="output-value" style="margin-top:8px;"><strong>${escapeHtml(pack.townMicroRoute.line)}</strong></p>
        <p id="daily-town-micro-route-caption" class="output-value">${escapeHtml(pack.townMicroRoute.captionAddOn)}</p>
        <p id="daily-town-micro-route-staff-line" class="output-value">${escapeHtml(pack.townMicroRoute.staffScript)}</p>
      </details>`
    : "";
  return `<section id="daily-pack" class="rounded-2xl p-6 shadow-sm bg-white">
    <h3>Your daily money move</h3>
    <details class="output-card" open>
      <summary><strong>Today’s Special</strong></summary>
      <p id="daily-special" class="output-value" style="margin-top:8px;"><strong>${escapeHtml(
        pack.todaySpecial.promoName,
      )}</strong><br/>${escapeHtml(pack.todaySpecial.offer)}<br/>${escapeHtml(pack.todaySpecial.timeWindow)}</p>
      <p class="muted">${escapeHtml(pack.todaySpecial.whyThisWorks)}</p>
    </details>
    <details class="output-card" open>
      <summary><strong>Ready-to-post caption</strong></summary>
      <p id="daily-caption" class="output-value" style="margin-top:8px;"><strong>${escapeHtml(
        pack.post.hook,
      )}</strong><br/>${escapeHtml(pack.post.caption)}<br/>${escapeHtml(pack.post.onScreenText.join(" | "))}</p>
      <p class="muted">Best time: ${escapeHtml(pack.post.bestTime)} · ${escapeHtml(pack.post.platform)}</p>
    </details>
    <details class="output-card" open>
      <summary><strong>In-store sign</strong></summary>
      <p id="daily-sign" class="output-value" style="margin-top:8px;"><strong>${escapeHtml(
        pack.sign.headline,
      )}</strong><br/>${escapeHtml(pack.sign.body)}${
        pack.sign.finePrint ? `<br/><span class="muted">${escapeHtml(pack.sign.finePrint)}</span>` : ""
      }</p>
      <a class="secondary-button" style="margin-top:6px;" href="${escapeHtml(signUrl)}" id="open-sign-print">Print sign</a>
    </details>
    ${
      pack.optionalSms.enabled
        ? `<details class="output-card">
            <summary><strong>Optional SMS</strong></summary>
            <p id="daily-sms" class="output-value" style="margin-top:8px;">${escapeHtml(
              pack.optionalSms.message,
            )}</p>
          </details>`
        : ""
    }
    ${localBoostSection}
    ${townBoostSection}
    ${townStorySection}
    ${townGraphSection}
    ${townMicroRouteSection}
    <div class="grid" style="grid-template-columns:1fr; margin-top:8px;">
      <button class="primary-button" data-copy-target="daily-caption">Copy Caption</button>
      <button class="primary-button" data-copy-target="daily-sign">Copy Sign</button>
      ${
        pack.localBoost
          ? `<button class="primary-button" data-copy-target="daily-local-caption-addon">Copy Local Caption Add-on</button>
             <button class="secondary-button" data-copy-target="daily-local-staff-line">Copy Staff Line</button>`
          : ""
      }
      ${
        pack.townBoost
          ? `<button class="primary-button" data-copy-target="daily-town-caption-addon">Copy Town Caption Add-on</button>
             <button class="secondary-button" data-copy-target="daily-town-staff-line">Copy Town Staff Line</button>`
          : ""
      }
      ${
        pack.optionalSms.enabled
          ? `<button class="primary-button" data-copy-target="daily-sms">Copy SMS</button>`
          : ""
      }
      ${
        pack.townStory
          ? `<button class="primary-button" data-copy-target="daily-town-story-caption">Copy Caption</button>
             <button class="secondary-button add-town-story-btn" type="button">Add to Today’s Post</button>`
          : ""
      }
      ${
        pack.townGraphBoost
          ? `<button class="primary-button" data-copy-target="daily-town-graph-caption">Copy Next Stop Caption</button>
             <button class="secondary-button" data-copy-target="daily-town-graph-staff-line">Copy Next Stop Staff Line</button>`
          : ""
      }
      ${
        pack.townMicroRoute
          ? `<button class="primary-button" data-copy-target="daily-town-micro-route-caption">Copy Route Add-on</button>
             <button class="secondary-button" data-copy-target="daily-town-micro-route-staff-line">Copy Route Staff Line</button>`
          : ""
      }
      <button class="secondary-button" id="share-daily" type="button">Share…</button>
      <a class="secondary-button" id="print-daily-sign" href="${escapeHtml(signUrl)}">Printable Sign</a>
    </div>
  </section>`;
}

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.selectedBrandId || !context.selectedBrand || !context.ownerUserId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Home",
            context,
            active: "home",
            currentPath: "/app",
            body: `<div class="rounded-2xl p-6 shadow-sm bg-white">
              <h2 class="text-xl">Let’s set up your first business</h2>
              <p class="muted">Use quick onboarding and Easy Mode will fill defaults automatically.</p>
              <a class="primary-button" href="/onboarding">Start onboarding</a>
            </div>`,
            notice: optionalText(req.query.notice),
          }),
        );
    }

    const [latest, checkin, townPulse] = await Promise.all([
      getLatestDailyPack(context.ownerUserId, context.selectedBrandId),
      dailyCheckinStatus(context.ownerUserId, context.selectedBrandId),
      getTownPulseModelForBrand({
        userId: context.ownerUserId,
        brandId: context.selectedBrandId,
        recomputeIfMissing: true,
      }).catch(() => null),
    ]);
    const signUrl = withSelection("/app/sign/today", context);
    const routeWindowOverride = parseTownWindowOverride(optionalText(req.query.window));
    const routeWindowOptions = [
      { value: "", label: "Auto (current)" },
      { value: "morning", label: "Morning" },
      { value: "lunch", label: "Lunch" },
      { value: "after_work", label: "After Work" },
      { value: "evening", label: "Evening" },
      { value: "weekend", label: "Weekend" },
    ];
    const routeWindowSelect = `<details style="margin-top:10px;">
      <summary class="muted">Advanced: route window (optional)</summary>
      <label class="field-label">Switch route window
        <select id="daily-window">
          ${routeWindowOptions
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value)}" ${
                  (routeWindowOverride ?? "") === option.value ? "selected" : ""
                }>${escapeHtml(option.label)}</option>`,
            )
            .join("")}
        </select>
      </label>
    </details>`;
    const townPulseIndicator = townPulse
      ? `<a class="secondary-button" href="${escapeHtml(withSelection("/app/town/pulse", context))}" style="margin-bottom:8px;">🟢 Town Pulse Active</a>`
      : `<a class="secondary-button" href="${escapeHtml(withSelection("/app/town/pulse", context))}" style="margin-bottom:8px;">⚪ Town Pulse Warming Up</a>`;

    const staffView =
      context.role === "member"
        ? `${townPulseIndicator}<section class="rounded-2xl p-6 shadow-sm bg-white">
            <h2 class="text-xl">Today’s Pack</h2>
            <p class="muted">Copy and post. No extra setup needed.</p>
          </section>
          ${
            latest
              ? renderDailyPackSection(latest.output, signUrl)
              : `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">No daily pack yet. Ask an owner to tap “Make Me Money Today”.</p></section>`
          }
          <section class="rounded-2xl p-6 shadow-sm bg-white">
            <p class="muted">Quick actions</p>
            <div class="two-col">
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/post-now", context))}">Post Now?</a>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/media", context))}">Upload Photo</a>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/insights", context))}">Insights</a>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/schedule", context))}">Planned Posts</a>
            </div>
          </section>`
        : null;

    const ownerView =
      context.role !== "member"
        ? `${townPulseIndicator}<section class="rounded-2xl p-6 shadow-sm bg-white">
            <h2 class="text-xl">One thing today</h2>
            <p class="muted">No dashboard. One move. Real-world output.</p>
            <details style="margin-top:10px;">
              <summary class="muted">Optional note for today</summary>
              <textarea id="daily-notes" placeholder="Only if needed: weather, staffing, special event, etc."></textarea>
            </details>
            ${routeWindowSelect}
            <button id="run-daily" class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="button">✅ Make Me Money Today</button>
            <button id="run-rescue" class="secondary-button w-full text-lg py-4 rounded-xl font-semibold" type="button" style="margin-top:10px;">🛟 Fix a Slow Day</button>
            <p id="daily-status" class="muted" style="margin-top:8px;"></p>
          </section>
          <section class="rounded-2xl p-6 shadow-sm bg-white">
            <div class="two-col">
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/post-now", context))}">Post Now?</a>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/media", context))}">Upload Photo</a>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/plan-week", context))}">Plan My Week</a>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/insights", context))}">Insights</a>
            </div>
          </section>
          <section id="rescue-output"></section>
          <section id="daily-pack-wrapper">
            ${
              latest
                ? renderDailyPackSection(latest.output, signUrl)
                : `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Tap “Make Me Money Today” to create today’s special, post, and sign.</p></section>`
            }
          </section>
          ${
            checkin.pending
              ? `<section class="rounded-2xl p-6 shadow-sm bg-white">
                  <h3>How did it go?</h3>
                  <p class="muted">One tap helps MainStreetAI learn your real patterns.</p>
                  <div class="two-col">
                    <button class="secondary-button checkin-btn" data-outcome="slow" type="button">Slow</button>
                    <button class="secondary-button checkin-btn" data-outcome="okay" type="button">Okay</button>
                    <button class="secondary-button checkin-btn" data-outcome="busy" type="button">Busy</button>
                  </div>
                  <label class="field-label" style="margin-top:8px;">Redemptions (optional)
                    <input id="checkin-redemptions" type="number" min="0" step="1" />
                  </label>
                  <p id="checkin-status" class="muted"></p>
                </section>`
              : ""
          }
          <script>
            const dailyEndpoint = ${JSON.stringify(withSelection("/api/daily", context))};
            const rescueEndpoint = ${JSON.stringify(withSelection("/api/rescue", context))};
            const checkinEndpoint = ${JSON.stringify(withSelection("/api/daily/checkin", context))};
            const signUrl = ${JSON.stringify(signUrl)};
            function esc(value) {
              return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
            }
            function windowLabel(value) {
              if (value === "after_work") return "After Work";
              if (value === "weekend") return "Weekend";
              if (value === "morning") return "Morning";
              if (value === "lunch") return "Lunch";
              return "Evening";
            }
            function renderDailyPack(pack) {
              const smsSection = pack.optionalSms?.enabled
                ? '<details class="output-card"><summary><strong>Optional SMS</strong></summary><p id="daily-sms" class="output-value" style="margin-top:8px;">' + esc(pack.optionalSms.message || "") + '</p></details>'
                : '';
              const localBoostSection = pack.localBoost
                ? '<details class="output-card"><summary><strong>Local Boost</strong></summary><p class="output-value" style="margin-top:8px;"><strong>' + esc(pack.localBoost.line || "") + '</strong></p><p id="daily-local-caption-addon" class="output-value">' + esc(pack.localBoost.captionAddOn || "") + '</p><p id="daily-local-staff-line" class="output-value">' + esc(pack.localBoost.staffScript || "") + '</p></details>'
                : '';
              const townBoostSection = pack.townBoost
                ? '<details class="output-card"><summary><strong>Town Boost</strong></summary><p class="output-value" style="margin-top:8px;"><strong>' + esc(pack.townBoost.line || "") + '</strong></p><p id="daily-town-caption-addon" class="output-value">' + esc(pack.townBoost.captionAddOn || "") + '</p><p id="daily-town-staff-line" class="output-value">' + esc(pack.townBoost.staffScript || "") + '</p></details>'
                : '';
              const townStorySection = pack.townStory
                ? '<details class="output-card"><summary><strong>Town Story (optional)</strong></summary><p class="output-value" style="margin-top:8px;"><strong>' + esc(pack.townStory.headline || "") + '</strong></p><p id="daily-town-story-caption" class="output-value">' + esc(pack.townStory.captionAddOn || "") + '</p><p id="daily-town-story-staff-line" class="output-value">' + esc(pack.townStory.staffLine || "") + '</p></details>'
                : '';
              const townGraphSection = pack.townGraphBoost
                ? '<details class="output-card"><summary><strong>Town Graph Boost (optional)</strong></summary><p class="output-value" style="margin-top:8px;"><strong>' + esc(pack.townGraphBoost.nextStopIdea || "") + '</strong></p><p id="daily-town-graph-caption" class="output-value">' + esc(pack.townGraphBoost.captionAddOn || "") + '</p><p id="daily-town-graph-staff-line" class="output-value">' + esc(pack.townGraphBoost.staffLine || "") + '</p></details>'
                : '';
              const townMicroRouteSection = pack.townMicroRoute
                ? '<details class="output-card"><summary><strong>Town Route Tip (' + esc(windowLabel(pack.townMicroRoute.window || "evening")) + ')</strong></summary><p class="output-value" style="margin-top:8px;"><strong>' + esc(pack.townMicroRoute.line || "") + '</strong></p><p id="daily-town-micro-route-caption" class="output-value">' + esc(pack.townMicroRoute.captionAddOn || "") + '</p><p id="daily-town-micro-route-staff-line" class="output-value">' + esc(pack.townMicroRoute.staffScript || "") + '</p></details>'
                : '';
              return '<section id="daily-pack" class="rounded-2xl p-6 shadow-sm bg-white">' +
                '<h3>Your daily money move</h3>' +
                '<details class="output-card" open><summary><strong>Today\\'s Special</strong></summary><p id="daily-special" class="output-value" style="margin-top:8px;"><strong>' + esc(pack.todaySpecial?.promoName || "") + '</strong><br/>' + esc(pack.todaySpecial?.offer || "") + '<br/>' + esc(pack.todaySpecial?.timeWindow || "") + '</p><p class="muted">' + esc(pack.todaySpecial?.whyThisWorks || "") + '</p></details>' +
                '<details class="output-card" open><summary><strong>Ready-to-post caption</strong></summary><p id="daily-caption" class="output-value" style="margin-top:8px;"><strong>' + esc(pack.post?.hook || "") + '</strong><br/>' + esc(pack.post?.caption || "") + '<br/>' + esc((pack.post?.onScreenText || []).join(" | ")) + '</p><p class="muted">Best time: ' + esc(pack.post?.bestTime || "") + ' · ' + esc(pack.post?.platform || "") + '</p></details>' +
                '<details class="output-card" open><summary><strong>In-store sign</strong></summary><p id="daily-sign" class="output-value" style="margin-top:8px;"><strong>' + esc(pack.sign?.headline || "") + '</strong><br/>' + esc(pack.sign?.body || "") + (pack.sign?.finePrint ? '<br/><span class="muted">' + esc(pack.sign.finePrint) + '</span>' : '') + '</p><a class="secondary-button" style="margin-top:6px;" href="' + esc(signUrl) + '">Print sign</a></details>' +
                smsSection +
                localBoostSection +
                townBoostSection +
                townStorySection +
                townGraphSection +
                townMicroRouteSection +
                '<div class="grid" style="grid-template-columns:1fr; margin-top:8px;">' +
                '<button class="primary-button" data-copy-target="daily-caption">Copy Caption</button>' +
                '<button class="primary-button" data-copy-target="daily-sign">Copy Sign</button>' +
                (pack.localBoost ? '<button class="primary-button" data-copy-target="daily-local-caption-addon">Copy Local Caption Add-on</button><button class="secondary-button" data-copy-target="daily-local-staff-line">Copy Staff Line</button>' : '') +
                (pack.townBoost ? '<button class="primary-button" data-copy-target="daily-town-caption-addon">Copy Town Caption Add-on</button><button class="secondary-button" data-copy-target="daily-town-staff-line">Copy Town Staff Line</button>' : '') +
                (pack.optionalSms?.enabled ? '<button class="primary-button" data-copy-target="daily-sms">Copy SMS</button>' : '') +
                (pack.townStory ? '<button class="primary-button" data-copy-target="daily-town-story-caption">Copy Caption</button><button class="secondary-button add-town-story-btn" type="button">Add to Today\\'s Post</button>' : '') +
                (pack.townGraphBoost ? '<button class="primary-button" data-copy-target="daily-town-graph-caption">Copy Next Stop Caption</button><button class="secondary-button" data-copy-target="daily-town-graph-staff-line">Copy Next Stop Staff Line</button>' : '') +
                (pack.townMicroRoute ? '<button class="primary-button" data-copy-target="daily-town-micro-route-caption">Copy Route Add-on</button><button class="secondary-button" data-copy-target="daily-town-micro-route-staff-line">Copy Route Staff Line</button>' : '') +
                '<button class="secondary-button" id="share-daily" type="button">Share…</button>' +
                '<a class="secondary-button" href="' + esc(signUrl) + '">Printable Sign</a>' +
                '</div></section>';
            }
            async function runDailyPack() {
              const status = document.getElementById("daily-status");
              if (status) status.textContent = "Building your daily pack...";
              const notes = document.getElementById("daily-notes")?.value || "";
              const selectedWindow = document.getElementById("daily-window")?.value || "";
              const endpointUrl = new URL(dailyEndpoint, window.location.origin);
              if (selectedWindow) {
                endpointUrl.searchParams.set("window", selectedWindow);
              } else {
                endpointUrl.searchParams.delete("window");
              }
              const response = await fetch(endpointUrl.pathname + endpointUrl.search, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notes: notes || undefined })
              });
              const json = await response.json().catch(() => ({}));
              if (!response.ok) {
                if (status) status.textContent = json.error || "Could not create daily pack.";
                return;
              }
              const wrapper = document.getElementById("daily-pack-wrapper");
              if (wrapper) wrapper.innerHTML = renderDailyPack(json);
              if (status) status.textContent = "Done. Copy and post.";
              window.__setupCopyButtons?.();
              const shareButton = document.getElementById("share-daily");
              shareButton?.addEventListener("click", async () => {
                const text = [
                  json.post?.hook,
                  json.post?.caption,
                  (json.post?.onScreenText || []).join(" | "),
                  json.localBoost?.captionAddOn,
                  json.townBoost?.captionAddOn,
                  json.townStory?.captionAddOn,
                  json.townGraphBoost?.captionAddOn,
                  json.townMicroRoute?.captionAddOn,
                ]
                  .filter(Boolean)
                  .join("\\n");
                if (navigator.share) {
                  await navigator.share({ title: "Today's Pack", text }).catch(() => {});
                } else {
                  await navigator.clipboard.writeText(text);
                }
              });
            }
            async function runRescuePack() {
              const status = document.getElementById("daily-status");
              if (status) status.textContent = "Building rescue plan...";
              const notes = document.getElementById("daily-notes")?.value || "";
              const response = await fetch(rescueEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ whatHappened: notes || undefined })
              });
              const json = await response.json().catch(() => ({}));
              if (!response.ok) {
                if (status) status.textContent = json.error || "Could not create rescue plan.";
                return;
              }
              const target = document.getElementById("rescue-output");
              if (target) {
                target.innerHTML = '<section class="rounded-2xl p-6 shadow-sm bg-white"><h3>Slow Day Rescue</h3>' +
                  '<div class="output-card"><p class="output-label">Offer</p><p class="output-value"><strong>' + esc(json.rescuePlan?.offer || "") + '</strong><br/>' + esc(json.rescuePlan?.timeWindow || "") + '</p></div>' +
                  '<div class="output-card"><p class="output-label">Post</p><p id="rescue-caption" class="output-value"><strong>' + esc(json.post?.hook || "") + '</strong><br/>' + esc(json.post?.caption || "") + '<br/>' + esc((json.post?.onScreenText || []).join(" | ")) + '</p><button class="primary-button" data-copy-target="rescue-caption">Copy Rescue Post</button></div>' +
                  '<div class="output-card"><p class="output-label">SMS</p><p id="rescue-sms" class="output-value">' + esc(json.sms?.message || "") + '</p><button class="secondary-button" data-copy-target="rescue-sms">Copy Rescue SMS</button></div>' +
                  '<div class="output-card"><p class="output-label">3 quick actions</p><p class="output-value">' + esc((json.threeQuickActions || []).join(" | ")) + '</p></div></section>';
              }
              if (status) status.textContent = "Rescue plan ready.";
              window.__setupCopyButtons?.();
            }
            document.getElementById("run-daily")?.addEventListener("click", runDailyPack);
            document.getElementById("run-rescue")?.addEventListener("click", runRescuePack);
            document.getElementById("share-daily")?.addEventListener("click", async () => {
              const text = [
                document.getElementById("daily-caption")?.textContent || "",
                document.getElementById("daily-sign")?.textContent || "",
                document.getElementById("daily-local-caption-addon")?.textContent || "",
                document.getElementById("daily-town-caption-addon")?.textContent || "",
                document.getElementById("daily-town-story-caption")?.textContent || "",
                document.getElementById("daily-town-graph-caption")?.textContent || "",
                document.getElementById("daily-town-micro-route-caption")?.textContent || "",
                document.getElementById("daily-sms")?.textContent || "",
              ]
                .filter(Boolean)
                .join("\\n\\n");
              if (!text) return;
              if (navigator.share) {
                await navigator.share({ title: "Today's Pack", text }).catch(() => {});
              } else {
                await navigator.clipboard.writeText(text).catch(() => {});
              }
            });
            document.querySelectorAll(".checkin-btn").forEach((button) => {
              button.addEventListener("click", async () => {
                const outcome = button.getAttribute("data-outcome");
                const redemptionsRaw = document.getElementById("checkin-redemptions")?.value || "";
                const redemptions = redemptionsRaw === "" ? undefined : Number.parseInt(redemptionsRaw, 10);
                const status = document.getElementById("checkin-status");
                if (status) status.textContent = "Saving...";
                const response = await fetch(checkinEndpoint, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ outcome, redemptions })
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok) {
                  if (status) status.textContent = json.error || "Could not save check-in.";
                  return;
                }
                if (status) status.textContent = "Saved. Thank you.";
              });
            });
            ${
              optionalText(req.query.runDaily) === "1"
                ? "setTimeout(() => document.getElementById('run-daily')?.click(), 80);"
                : ""
            }
          </script>`
        : null;

    const body = context.role === "member" ? staffView ?? "" : ownerView ?? "";

    return res
      .type("html")
      .send(
        easyLayout({
          title: "Home",
          context,
          active: "home",
          currentPath: "/app",
          body,
          notice: optionalText(req.query.notice),
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/create", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const body = `<div class="rounded-2xl p-6 shadow-sm bg-white">
        <h2 class="text-xl">Create</h2>
        <p class="muted">Pick one thing to make now.</p>
      </div>
      <div class="grid">
        ${cardLink(withSelection("/app/promo", context), "🟢", "Make Today’s Special", "Promo + sign + caption + SMS")}
        ${cardLink(withSelection("/app/social", context), "🎥", "Create Social Post", "Hooks, caption, reel text")}
        ${cardLink(withSelection("/app/post-now", context), "⚡", "Should I Post Right Now?", "Real-time timing coach")}
      </div>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Create",
          context,
          active: "create",
          currentPath: "/app/create",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/analyze", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const body = `<div class="rounded-2xl p-6 shadow-sm bg-white">
        <h2 class="text-xl">Analyze</h2>
        <p class="muted">Improve today’s post quality and timing.</p>
      </div>
      <div class="grid">
        ${cardLink(withSelection("/app/media", context), "📸", "Make This Photo Better", "Get caption + on-screen text")}
        ${cardLink(withSelection("/app/insights", context), "📊", "Performance Insights", "Learn what to repeat next")}
      </div>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Analyze",
          context,
          active: "analyze",
          currentPath: "/app/analyze",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/schedule", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.ownerUserId || !context.selectedBrandId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Schedule",
            context,
            active: "schedule",
            currentPath: "/app/schedule",
            body: `<div class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Pick a business to view planned posts.</p></div>`,
          }),
        );
    }

    const now = new Date();
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [planned, todayTasks] = await Promise.all([
      getAdapter().listSchedule(context.ownerUserId, context.selectedBrandId, {
        from: now.toISOString(),
        to: to.toISOString(),
      }),
      buildTodayTasks(context.ownerUserId, context.selectedBrandId),
    ]);
    const plannedRows =
      planned.length > 0
        ? planned
            .map((item) => {
              const when = new Date(item.scheduledFor).toLocaleString();
              return `<div class="output-card">
                <p class="output-label">Planned Post · ${escapeHtml(item.platform)}</p>
                <p class="output-value"><strong>${escapeHtml(item.title)}</strong></p>
                <p class="muted">${escapeHtml(when)}</p>
                <p class="output-value">${escapeHtml(item.caption)}</p>
              </div>`;
            })
            .join("")
        : `<p class="muted">No planned posts yet for the next 7 days.</p>`;
    const tasks = todayTasks.tasks
      .map(
        (task) => `<li><strong>${escapeHtml(task.title)}:</strong> ${escapeHtml(task.notes)}</li>`,
      )
      .join("");
    const body = `<div class="rounded-2xl p-6 shadow-sm bg-white">
        <h2 class="text-xl">Schedule</h2>
        <p class="muted">Simple checklist for consistency.</p>
      </div>
      <div class="rounded-2xl p-6 shadow-sm bg-white">
        <h3>Today’s checklist</h3>
        <ul class="list">${tasks}</ul>
      </div>
      <div class="rounded-2xl p-6 shadow-sm bg-white">
        <h3>Upcoming planned posts</h3>
        ${plannedRows}
      </div>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Schedule",
          context,
          active: "schedule",
          currentPath: "/app/schedule",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/promo", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const endpoint = withSelection("/api/promo", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Make Today’s Special</h2>
      <p class="muted">Tell us what’s happening today. We’ll draft your special + copy.</p>
      <form id="promo-form" style="display:grid;gap:10px;margin-top:10px;">
        <label class="field-label">What’s happening today? (optional)
          <textarea id="promo-notes" placeholder="School game tonight, weather is rainy, short staff..."></textarea>
        </label>
        <label class="field-label">Weather today
          <select id="promo-weather">
            <option value="nice">nice</option>
            <option value="hot">hot</option>
            <option value="cold">cold</option>
            <option value="rainy">rainy</option>
            <option value="windy">windy</option>
          </select>
        </label>
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">Create Today’s Special</button>
      </form>
      <p id="promo-status" class="muted" style="margin-top:8px;"></p>
    </section>
    <section id="promo-output" class="rounded-2xl p-6 shadow-sm bg-white" style="display:none;">
      <h3>Your ready-to-use content</h3>
      <div class="output-card"><p class="output-label">Promo name</p><p id="promo-name" class="output-value"></p></div>
      <div class="output-card"><p class="output-label">Sign text</p><p id="promo-sign" class="output-value"></p><button class="copy-button" data-copy-target="promo-sign">Copy</button></div>
      <div class="output-card"><p class="output-label">Caption</p><p id="promo-caption" class="output-value"></p><button class="copy-button" data-copy-target="promo-caption">Copy</button></div>
      <div class="output-card"><p class="output-label">SMS</p><p id="promo-sms" class="output-value"></p><button class="copy-button" data-copy-target="promo-sms">Copy</button></div>
    </section>
    <script>
      const promoForm = document.getElementById("promo-form");
      const promoStatus = document.getElementById("promo-status");
      const promoOutput = document.getElementById("promo-output");
      promoForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        promoStatus.textContent = "Creating your special...";
        const notes = document.getElementById("promo-notes")?.value || "";
        const weather = document.getElementById("promo-weather")?.value || "nice";
        const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date());
        const payload = {
          dateLabel: weekday,
          weather,
          goal: ${JSON.stringify(context.defaultGoal)},
          slowHours: ${JSON.stringify(context.selectedBrand?.slowHours ?? "1pm-3pm")},
          inventoryNotes: notes || undefined,
          includeLocalEvents: true
        };
        const response = await fetch(${JSON.stringify(endpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          promoStatus.textContent = json.error || "Could not create special.";
          return;
        }
        promoStatus.textContent = "Done. Ready to copy.";
        document.getElementById("promo-name").textContent = json.promoName || "";
        document.getElementById("promo-sign").textContent = json.inStoreSign || "";
        document.getElementById("promo-caption").textContent = json.socialCaption || "";
        document.getElementById("promo-sms").textContent = json.smsText || "";
        promoOutput.style.display = "block";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Today’s Special",
          context,
          active: "create",
          currentPath: "/app/promo",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/social", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const endpoint = withSelection("/api/social", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Create Social Post</h2>
      <form id="social-form" style="display:grid;gap:10px;margin-top:10px;">
        <label class="field-label">What are we posting today?
          <textarea id="social-special" placeholder="Fresh strawberry energy tea + teacher happy hour"></textarea>
        </label>
        <div class="two-col">
          <label class="field-label">Audience
            <input id="social-audience" value="${escapeHtml(context.defaultAudience)}" />
          </label>
          <label class="field-label">Tone
            <select id="social-tone">
              <option value="fun">fun</option>
              <option value="cozy">cozy</option>
              <option value="hype">hype</option>
              <option value="calm">calm</option>
            </select>
          </label>
        </div>
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">Create Social Post</button>
      </form>
      <p id="social-status" class="muted" style="margin-top:8px;"></p>
    </section>
    <section id="social-output" class="rounded-2xl p-6 shadow-sm bg-white" style="display:none;">
      <div class="output-card"><p class="output-label">Hook ideas</p><p id="social-hooks" class="output-value"></p><button class="copy-button" data-copy-target="social-hooks">Copy</button></div>
      <div class="output-card"><p class="output-label">Caption</p><p id="social-caption" class="output-value"></p><button class="copy-button" data-copy-target="social-caption">Copy</button></div>
      <div class="output-card"><p class="output-label">On-screen text</p><p id="social-onscreen" class="output-value"></p><button class="copy-button" data-copy-target="social-onscreen">Copy</button></div>
    </section>
    <script>
      const form = document.getElementById("social-form");
      const status = document.getElementById("social-status");
      const output = document.getElementById("social-output");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "Creating your post...";
        const payload = {
          todaySpecial: document.getElementById("social-special")?.value || "Today’s featured drink",
          audience: document.getElementById("social-audience")?.value || ${JSON.stringify(context.defaultAudience)},
          tone: document.getElementById("social-tone")?.value || "fun"
        };
        const response = await fetch(${JSON.stringify(endpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = json.error || "Could not create post.";
          return;
        }
        status.textContent = "Done. Ready to post.";
        document.getElementById("social-hooks").textContent = (json.hookLines || []).join(" | ");
        document.getElementById("social-caption").textContent = json.caption || "";
        document.getElementById("social-onscreen").textContent = (json.reelScript?.onScreenText || []).join(" | ");
        output.style.display = "block";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Create Social Post",
          context,
          active: "create",
          currentPath: "/app/social",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/plan-week", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const endpoint = withSelection("/api/week-plan", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Plan My Week</h2>
      <p class="muted">One tap weekly plan, using your best patterns.</p>
      <form id="week-form" style="display:grid;gap:10px;margin-top:10px;">
        <label class="field-label">Notes (optional)
          <textarea id="week-notes" placeholder="Any events or priorities this week?"></textarea>
        </label>
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">Build Weekly Plan</button>
      </form>
      <p id="week-status" class="muted" style="margin-top:8px;"></p>
    </section>
    <section id="week-output" class="rounded-2xl p-6 shadow-sm bg-white" style="display:none;">
      <div class="output-card"><p class="output-label">Theme</p><p id="week-theme" class="output-value"></p></div>
      <div class="output-card"><p class="output-label">Daily plan</p><p id="week-days" class="output-value"></p></div>
    </section>
    <script>
      function nextMonday() {
        const now = new Date();
        const day = now.getDay();
        const delta = (8 - day) % 7 || 7;
        const target = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);
        return target.toISOString().slice(0, 10);
      }
      const form = document.getElementById("week-form");
      const status = document.getElementById("week-status");
      const output = document.getElementById("week-output");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "Building plan...";
        const payload = {
          startDate: nextMonday(),
          goal: ${JSON.stringify(context.defaultGoal)},
          focusAudience: ${JSON.stringify(context.defaultAudience)},
          includeLocalEvents: true,
          notes: document.getElementById("week-notes")?.value || undefined
        };
        const response = await fetch(${JSON.stringify(endpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = json.error || "Could not build week plan.";
          return;
        }
        status.textContent = "Plan ready.";
        document.getElementById("week-theme").textContent = json.weekTheme || "";
        document.getElementById("week-days").textContent = (json.dailyPlan || [])
          .map((day) => (day.dayLabel || "") + ": " + (day.promoName || ""))
          .join(" | ");
        output.style.display = "block";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Plan My Week",
          context,
          active: "create",
          currentPath: "/app/plan-week",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/post-now", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const endpoint = withSelection("/api/post-now", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Post Now?</h2>
      <p class="muted">Best predicted window: ${escapeHtml(context.bestPostTimeLabel)}</p>
      <form id="post-now-form" style="display:grid;gap:10px;margin-top:10px;">
        <label class="field-label">Platform
          <select id="post-now-platform">
            <option value="instagram">instagram</option>
            <option value="facebook">facebook</option>
            <option value="tiktok">tiktok</option>
            <option value="gbp">google business</option>
            <option value="other">other</option>
          </select>
        </label>
        <label class="field-label">Today notes (optional)
          <textarea id="post-now-notes" placeholder="After-school traffic is high right now"></textarea>
        </label>
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">Should I Post Right Now?</button>
      </form>
    </section>
    <section id="post-now-output" class="rounded-2xl p-6 shadow-sm bg-white" style="display:none;">
      <h3 id="post-now-decision" class="status-good"></h3>
      <p id="post-now-why" class="output-value"></p>
      <div class="output-card"><p class="output-label">Hook</p><p id="post-now-hook" class="output-value"></p><button class="copy-button" data-copy-target="post-now-hook">Copy</button></div>
      <div class="output-card"><p class="output-label">Caption</p><p id="post-now-caption" class="output-value"></p><button class="copy-button" data-copy-target="post-now-caption">Copy</button></div>
    </section>
    <script>
      const form = document.getElementById("post-now-form");
      const output = document.getElementById("post-now-output");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = {
          platform: document.getElementById("post-now-platform")?.value || "instagram",
          todayNotes: document.getElementById("post-now-notes")?.value || ""
        };
        const response = await fetch(${JSON.stringify(endpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          alert(json.error || "Could not run post-now coach.");
          return;
        }
        const decision = document.getElementById("post-now-decision");
        decision.textContent = json.postNow ? "YES — Post now" : "WAIT — Better time coming";
        decision.className = json.postNow ? "status-good" : "status-wait";
        document.getElementById("post-now-why").textContent = json.why || "";
        document.getElementById("post-now-hook").textContent = json.whatToPost?.hook || "";
        document.getElementById("post-now-caption").textContent = json.whatToPost?.caption || "";
        output.style.display = "block";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Post Now?",
          context,
          active: "create",
          currentPath: "/app/post-now",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/media", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const analyzeEndpoint = withSelection("/api/media/analyze", context);
    const uploadEndpoint = withSelection("/api/media/upload-url", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Analyze Photo</h2>
      <p class="muted">Upload or paste an image URL and get clear fixes.</p>
      <div class="output-card">
        <label class="field-label">Upload image (optional)
          <input id="media-file" type="file" accept="image/*" />
        </label>
        <button class="secondary-button" id="upload-file-btn" type="button">Upload selected image</button>
        <p id="upload-status" class="muted"></p>
      </div>
      <form id="media-form" style="display:grid;gap:10px;margin-top:10px;">
        <label class="field-label">Image URL
          <input id="media-url" placeholder="https://..." />
        </label>
        <div class="two-col">
          <label class="field-label">Platform
            <select id="media-platform">
              <option value="instagram">instagram</option>
              <option value="facebook">facebook</option>
              <option value="tiktok">tiktok</option>
              <option value="gbp">google business</option>
            </select>
          </label>
          <label class="field-label">What is shown? (optional)
            <input id="media-context" placeholder="new mango drink close-up" />
          </label>
        </div>
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">Make This Post Better</button>
      </form>
    </section>
    <section id="media-output" class="rounded-2xl p-6 shadow-sm bg-white" style="display:none;">
      <div class="output-card"><p class="output-label">On-screen text</p><p id="media-onscreen" class="output-value"></p><button class="copy-button" data-copy-target="media-onscreen">Copy</button></div>
      <div class="output-card"><p class="output-label">Caption rewrite</p><p id="media-caption" class="output-value"></p><button class="copy-button" data-copy-target="media-caption">Copy</button></div>
      <div class="output-card"><p class="output-label">Simple tips</p><p id="media-tips" class="output-value"></p></div>
    </section>
    <script>
      const uploadStatus = document.getElementById("upload-status");
      const uploadBtn = document.getElementById("upload-file-btn");
      uploadBtn?.addEventListener("click", async () => {
        const fileInput = document.getElementById("media-file");
        const file = fileInput?.files?.[0];
        if (!file) {
          uploadStatus.textContent = "Choose a file first.";
          return;
        }
        uploadStatus.textContent = "Preparing upload...";
        const signed = await fetch(${JSON.stringify(uploadEndpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type, kind: "image" })
        });
        const signedJson = await signed.json().catch(() => ({}));
        if (!signed.ok) {
          uploadStatus.textContent = signedJson.error || "Upload URL unavailable. Paste image URL instead.";
          return;
        }
        const putResponse = await fetch(signedJson.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file
        });
        if (!putResponse.ok) {
          uploadStatus.textContent = "Upload failed. Try image URL instead.";
          return;
        }
        document.getElementById("media-url").value = signedJson.publicUrl || "";
        uploadStatus.textContent = "Upload complete. Ready to analyze.";
      });

      const form = document.getElementById("media-form");
      const output = document.getElementById("media-output");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const imageUrl = (document.getElementById("media-url")?.value || "").trim();
        if (!imageUrl) {
          alert("Please upload or paste an image URL first.");
          return;
        }
        const payload = {
          imageUrl,
          platform: document.getElementById("media-platform")?.value || "instagram",
          goals: [${JSON.stringify(context.defaultGoal)}],
          imageContext: document.getElementById("media-context")?.value || ""
        };
        const response = await fetch(${JSON.stringify(analyzeEndpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          alert(json.error || "Could not analyze image.");
          return;
        }
        document.getElementById("media-onscreen").textContent = (json.analysis?.onScreenTextOptions || []).join(" | ");
        document.getElementById("media-caption").textContent = json.analysis?.captionRewrite || "";
        const tips = []
          .concat(json.analysis?.whatWorks || [])
          .concat(json.analysis?.whatHurts || [])
          .slice(0, 6);
        document.getElementById("media-tips").textContent = tips.join(" | ");
        output.style.display = "block";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Analyze Photo",
          context,
          active: "analyze",
          currentPath: "/app/media",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/sms", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const message = context.ownerUserId && context.selectedBrandId
      ? await smsSuggestion(context.ownerUserId, context.selectedBrandId)
      : "";
    const endpoint = withSelection("/api/sms/send", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Send SMS</h2>
      <p class="muted">Only send to people who opted in.</p>
      <form id="sms-form" style="display:grid;gap:10px;margin-top:10px;">
        <label class="field-label">Phone number
          <input id="sms-to" placeholder="+1..." />
        </label>
        <label class="field-label">Message
          <textarea id="sms-message">${escapeHtml(message)}</textarea>
        </label>
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">Send SMS</button>
      </form>
      <p id="sms-status" class="muted" style="margin-top:8px;"></p>
    </section>
    <script>
      const form = document.getElementById("sms-form");
      const status = document.getElementById("sms-status");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "Sending...";
        const payload = {
          to: document.getElementById("sms-to")?.value || "",
          message: document.getElementById("sms-message")?.value || "",
          purpose: "promo",
          sendNow: true
        };
        const response = await fetch(${JSON.stringify(endpoint)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = json.error || "Could not send SMS.";
          return;
        }
        status.textContent = "Queued. Your message is on the way.";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Send SMS",
          context,
          active: "create",
          currentPath: "/app/sms",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/insights", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    const endpoint = withSelection("/api/insights", context);
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Insights</h2>
      <p class="muted">Simple summary of what worked.</p>
      <button id="load-insights" class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="button">Load Insights</button>
      <p id="insights-status" class="muted" style="margin-top:8px;"></p>
    </section>
    <section id="insights-output" class="rounded-2xl p-6 shadow-sm bg-white" style="display:none;">
      <div class="output-card"><p class="output-label">Summary</p><p id="insights-summary" class="output-value"></p></div>
      <div class="output-card"><p class="output-label">What to repeat</p><p id="insights-repeat" class="output-value"></p></div>
      <div class="output-card"><p class="output-label">What to avoid</p><p id="insights-avoid" class="output-value"></p></div>
    </section>
    <script>
      const button = document.getElementById("load-insights");
      const status = document.getElementById("insights-status");
      const output = document.getElementById("insights-output");
      button?.addEventListener("click", async () => {
        status.textContent = "Loading insights...";
        const response = await fetch(${JSON.stringify(endpoint)});
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = json.error || "Could not load insights.";
          return;
        }
        status.textContent = "Updated.";
        document.getElementById("insights-summary").textContent = json.insights?.summary || "";
        document.getElementById("insights-repeat").textContent = (json.insights?.whatToRepeat || []).join(" | ");
        document.getElementById("insights-avoid").textContent = (json.insights?.whatToAvoid || []).join(" | ");
        output.style.display = "block";
      });
      button?.click();
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Insights",
          context,
          active: "analyze",
          currentPath: "/app/insights",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/tomorrow", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.ownerUserId || !context.selectedBrandId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Tomorrow Ready",
            context,
            active: "home",
            currentPath: "/app/tomorrow",
            body: `<div class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Pick a business first.</p></div>`,
          }),
        );
    }
    const [pack, bufferIntegration] = await Promise.all([
      latestTomorrowPack(context.ownerUserId, context.selectedBrandId),
      getAdapter().getIntegration(context.ownerUserId, context.selectedBrandId, "buffer"),
    ]);
    const packCard = pack
      ? `<div class="output-card">
          <p class="output-label">Tomorrow’s promo</p>
          <p id="tomorrow-promo" class="output-value"><strong>${escapeHtml(pack.output.promo.promoName)}</strong><br/>${escapeHtml(
            pack.output.promo.offer,
          )}</p>
        </div>
        <div class="output-card">
          <p class="output-label">Tomorrow’s caption</p>
          <p id="tomorrow-caption" class="output-value">${escapeHtml(pack.output.post.caption)}</p>
          <button class="copy-button" data-copy-target="tomorrow-caption">Copy</button>
        </div>
        <div class="output-card">
          <p class="output-label">Best post time</p>
          <p id="tomorrow-best-time" class="output-value">${escapeHtml(pack.output.post.bestPostTime)}</p>
        </div>`
      : `<p class="muted" id="tomorrow-empty">No tomorrow-ready pack yet. Tap the button below to create one.</p>`;
    const publishButton = bufferIntegration
      ? `<button id="publish-tomorrow" class="secondary-button" type="button">Publish caption now</button>`
      : `<p class="muted">Connect Buffer in Integrations to publish directly.</p>`;

    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Tomorrow Ready</h2>
      <p class="muted">Your daily ready-to-use pack.</p>
      <button id="run-tomorrow" class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="button">Build Tomorrow Pack</button>
      <p id="tomorrow-status" class="muted" style="margin-top:8px;"></p>
    </section>
    <section id="tomorrow-output" class="rounded-2xl p-6 shadow-sm bg-white">
      ${packCard}
      ${publishButton}
    </section>
    <script>
      let currentCaption = ${JSON.stringify(pack?.output.post.caption ?? "")};
      let currentPlatform = ${JSON.stringify(pack?.output.post.platform ?? "instagram")};
      function safePlatform(input) {
        if (input === "facebook" || input === "instagram" || input === "tiktok") return input;
        return "instagram";
      }
      const status = document.getElementById("tomorrow-status");
      document.getElementById("run-tomorrow")?.addEventListener("click", async () => {
        status.textContent = "Building tomorrow pack...";
        const response = await fetch(${JSON.stringify(withSelection("/api/autopilot/run", context))}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = json.error || "Could not build tomorrow pack.";
          return;
        }
        const output = json.output || json.locationRuns?.[0]?.output;
        if (!output) {
          status.textContent = "Pack created, but no output returned.";
          return;
        }
        currentCaption = output.post?.caption || "";
        currentPlatform = output.post?.platform || "instagram";
        document.getElementById("tomorrow-promo")?.replaceChildren(document.createTextNode((output.promo?.promoName || "") + " — " + (output.promo?.offer || "")));
        document.getElementById("tomorrow-caption")?.replaceChildren(document.createTextNode(currentCaption));
        document.getElementById("tomorrow-best-time")?.replaceChildren(document.createTextNode(output.post?.bestPostTime || ""));
        document.getElementById("tomorrow-empty")?.remove();
        status.textContent = "Tomorrow pack is ready.";
      });
      document.getElementById("publish-tomorrow")?.addEventListener("click", async () => {
        if (!currentCaption) {
          alert("Create tomorrow pack first.");
          return;
        }
        status.textContent = "Queueing publish...";
        const response = await fetch(${JSON.stringify(withSelection("/api/publish", context))}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: safePlatform(currentPlatform),
            caption: currentCaption,
            source: "manual"
          })
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = json.error || "Could not queue publish.";
          return;
        }
        status.textContent = json.queued ? "Queued for publishing." : "Published.";
      });
    </script>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Tomorrow Ready",
          context,
          active: "home",
          currentPath: "/app/tomorrow",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/sign/today", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context || !context.ownerUserId || !context.selectedBrandId || !context.selectedBrand) {
      return;
    }
    const latest = await getLatestDailyPack(context.ownerUserId, context.selectedBrandId);
    if (!latest) {
      return res
        .status(404)
        .type("html")
        .send(
          easyLayout({
            title: "Today Sign",
            context,
            active: "home",
            currentPath: "/app/sign/today",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">No daily pack found yet. Tap “Make Me Money Today” first.</p></section>`,
          }),
        );
    }

    if (String(req.query.pdf ?? "") === "1") {
      const doc = new PDFDocument({ size: "LETTER", margin: 50 });
      const safeBusinessName = context.selectedBrand.businessName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeBusinessName}-today-sign.pdf"`);
      doc.pipe(res);
      doc.fontSize(30).text(context.selectedBrand.businessName, { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(16).fillColor("#555555").text(context.selectedBrand.location, { align: "center" });
      doc.moveDown(1.4);
      doc.fillColor("#000000");
      doc.fontSize(28).text(latest.output.sign.headline, { align: "center" });
      doc.moveDown(0.8);
      doc.fontSize(20).text(latest.output.sign.body, { align: "center" });
      doc.moveDown(1);
      if (latest.output.sign.finePrint) {
        doc.fontSize(12).fillColor("#444444").text(latest.output.sign.finePrint, { align: "center" });
      }
      doc.moveDown(2);
      doc.fillColor("#111111");
      doc.fontSize(12).text(`Today’s Special: ${latest.output.todaySpecial.promoName}`, { align: "center" });
      doc.end();
      return;
    }

    const pdfUrl = withSelection("/app/sign/today", context, { pdf: "1" });
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Printable Sign</h2>
      <p class="muted">One tap print for your counter or window.</p>
      <a class="primary-button" href="${escapeHtml(pdfUrl)}" target="_blank">Print / Save PDF</a>
    </section>
    <section class="rounded-2xl p-6 shadow-sm bg-white">
      <p class="output-value"><strong>${escapeHtml(latest.output.sign.headline)}</strong><br/>${escapeHtml(
        latest.output.sign.body,
      )}</p>
      ${latest.output.sign.finePrint ? `<p class="muted">${escapeHtml(latest.output.sign.finePrint)}</p>` : ""}
      <iframe title="Today sign PDF" src="${escapeHtml(pdfUrl)}" style="width:100%;height:60vh;border:1px solid #d1d5db;border-radius:12px;"></iframe>
    </section>`;

    return res
      .type("html")
      .send(
        easyLayout({
          title: "Today Sign",
          context,
          active: "home",
          currentPath: "/app/sign/today",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (context.role === "member") {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Settings",
            context,
            active: "home",
            currentPath: "/app/settings",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Settings are owner/admin only. You can still copy and post today’s pack.</p></section>`,
          }),
        );
    }
    const autopilotOn = Boolean(context.autopilotSettings?.enabled);
    const townContext =
      context.ownerUserId && context.selectedBrandId
        ? await getTownMembershipForBrand({
            userId: context.ownerUserId,
            brandId: context.selectedBrandId,
          }).catch(() => null)
        : null;
    const townEnabled = townContext ? townContext.membership.participationLevel !== "hidden" : false;
    const participationLevel = townContext?.membership.participationLevel ?? "standard";
    const preferredPartnerCategories =
      context.ownerUserId && context.selectedBrandId
        ? await listPreferredPartnerCategoriesForBrand({
            userId: context.ownerUserId,
            brandId: context.selectedBrandId,
          }).catch(() => [])
        : [];
    const baseCategory = context.selectedBrand
      ? townGraphCategoryFromBrandType(context.selectedBrand.type)
      : ("other" as TownGraphCategory);
    const defaultTownName =
      townContext?.town.name ??
      suggestTownFromLocation(context.selectedBrand?.location ?? "") ??
      "";
    const partnerCategoryCheckboxes = GRAPH_CATEGORY_OPTIONS
      .filter((category) => category !== baseCategory)
      .map((category) => {
        const checked = preferredPartnerCategories.includes(category) ? "checked" : "";
        return `<label><input type="checkbox" name="partnerCategories" value="${escapeHtml(category)}" ${checked} /> ${escapeHtml(
          townGraphCategoryLabel(category),
        )}</label>`;
      })
      .join("");
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Settings</h2>
      <p class="muted">Keep this simple. Advanced tools are in Advanced Settings.</p>
      <form method="POST" action="${escapeHtml(withSelection("/app/settings/automatic-help", context))}">
        <input type="hidden" name="enabled" value="${autopilotOn ? "false" : "true"}" />
        <button class="primary-button w-full text-lg py-4 rounded-xl font-semibold" type="submit">
          ${autopilotOn ? "Automatic Help: ON (tap to turn off)" : "Automatic Help: OFF (tap to turn on)"}
        </button>
      </form>
    </section>
    <section class="rounded-2xl p-6 shadow-sm bg-white">
      <h3>Local Network</h3>
      <p class="muted">Join Town Mode for subtle local cross-support ideas.</p>
      <form method="POST" action="${escapeHtml(withSelection("/app/settings/local-network", context))}" style="display:grid;gap:10px;">
        <label><input type="checkbox" name="enabled" ${townEnabled ? "checked" : ""} /> Participate in Local Town Mode</label>
        <label class="field-label">Town
          <input name="townName" value="${escapeHtml(defaultTownName)}" placeholder="Independence KS" />
        </label>
        <label class="field-label">Participation level
          <select name="participationLevel">
            <option value="standard" ${participationLevel === "standard" ? "selected" : ""}>standard</option>
            <option value="leader" ${participationLevel === "leader" ? "selected" : ""}>leader</option>
            <option value="hidden" ${participationLevel === "hidden" ? "selected" : ""}>hidden</option>
          </select>
        </label>
        <fieldset style="border:1px solid #d1d5db;border-radius:12px;padding:10px;">
          <legend class="muted" style="padding:0 6px;">Pick partner categories for optional collaboration</legend>
          <div style="display:grid;gap:8px;grid-template-columns:1fr 1fr;">
            ${partnerCategoryCheckboxes}
          </div>
        </fieldset>
        <button class="secondary-button" type="submit">Save Local Network</button>
      </form>
      ${
        townContext
          ? `<a class="secondary-button" href="${escapeHtml(withSelection("/app/town", context))}" style="margin-top:10px;">View Local Network</a>`
          : ""
      }
    </section>
    <section class="rounded-2xl p-6 shadow-sm bg-white">
      <div class="grid">
        ${cardLink(withSelection("/admin/locations", context), "📍", "My Locations", "Manage store locations")}
        ${cardLink(withSelection("/admin/team", context), "👥", "My Team", "Invite and manage team")}
        ${cardLink(withSelection("/admin/billing", context), "💳", "Billing", "Plan and subscription")}
        ${cardLink(withSelection("/admin/integrations", context), "🔌", "Integrations", "Buffer, SMS, Google, email")}
        ${cardLink(withSelection("/app/town", context), "🏙️", "Local Network", "See your town participation map")}
        ${cardLink(withSelection("/app/town/graph", context), "🧭", "Town Graph", "View common local customer flow")}
      </div>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/settings/advanced", context))}" style="margin-top:10px;">Open Advanced Settings</a>
    </section>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Settings",
          context,
          active: "settings",
          currentPath: "/app/settings",
          body,
          notice: optionalText(req.query.notice),
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.post("/settings/automatic-help", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context || !context.ownerUserId || !context.selectedBrandId) {
      return;
    }
    if (context.role === "member") {
      return res.redirect(withNotice(withSelection("/app", context), "Only owners/admins can change settings."));
    }
    const desired = String(req.body?.enabled ?? "").toLowerCase() === "true";
    if (desired) {
      const planCheck = await requirePlan(context.ownerUserId, context.selectedBrandId, "pro");
      if (!planCheck.ok) {
        return res.redirect(withNotice(withSelection("/app/settings", context), "Upgrade to Pro for Automatic Help."));
      }
    }
    await getAdapter().upsertAutopilotSettings(context.ownerUserId, context.selectedBrandId, {
      enabled: desired,
    });
    return res.redirect(
      withNotice(withSelection("/app/settings", context), desired ? "Automatic Help is now ON." : "Automatic Help is now OFF."),
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/settings/local-network", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context || !context.ownerUserId || !context.selectedBrandId) {
      return;
    }
    if (context.role === "member") {
      return res.redirect(withNotice(withSelection("/app", context), "Only owners/admins can change settings."));
    }
    const enabledRaw = String(req.body?.enabled ?? "").toLowerCase();
    const enabled = enabledRaw === "on" || enabledRaw === "true" || enabledRaw === "1";
    const participationLevel = String(req.body?.participationLevel ?? "standard").trim().toLowerCase();
    const rawPartnerCategories = req.body?.partnerCategories;
    const partnerCategoryList = (
      Array.isArray(rawPartnerCategories)
        ? rawPartnerCategories
        : rawPartnerCategories !== undefined
          ? [rawPartnerCategories]
          : []
    )
      .map((entry) => String(entry))
      .map((entry) => townGraphCategorySchema.safeParse(entry))
      .filter((entry): entry is { success: true; data: TownGraphCategory } => entry.success)
      .map((entry) => entry.data);
    const partnerCategories = [...new Set(partnerCategoryList)];
    const townName = optionalText(req.body?.townName) ?? suggestTownFromLocation(context.selectedBrand?.location ?? "");
    await updateTownMembershipForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
      fallbackTownName: suggestTownFromLocation(context.selectedBrand?.location ?? ""),
      settings: {
        enabled,
        participationLevel:
          participationLevel === "leader" || participationLevel === "hidden" || participationLevel === "standard"
            ? participationLevel
            : "standard",
        townName,
      },
    });
    if (enabled && partnerCategories.length > 0) {
      await recordManualCategoryPreferencesForBrand({
        userId: context.ownerUserId,
        brandId: context.selectedBrandId,
        toCategories: partnerCategories,
      }).catch(() => {
        // Preference edges are optional and should not block settings save.
      });
    }
    return res.redirect(withNotice(withSelection("/app/settings", context), "Local network settings saved."));
  } catch (error) {
    const context = await resolveContext(req, res);
    if (context) {
      return res.redirect(withNotice(withSelection("/app/settings", context), "Could not save local network settings."));
    }
    return next(error);
  }
});

router.get("/settings/advanced", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (context.role === "member") {
      return res.redirect(withNotice(withSelection("/app", context), "Advanced settings are owner/admin only."));
    }
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Advanced Settings</h2>
      <p class="muted">For power users and agencies.</p>
      <div class="grid">
        ${cardLink(withSelection("/admin", context), "🧰", "Admin Workspace", "Full toolset")}
        ${cardLink(withSelection("/admin/autopilot", context), "🤖", "Automatic Help Details", "Cadence, channels, notifications")}
        ${cardLink(withSelection("/admin/voice", context), "🗣️", "Brand Voice Training", "Tune your writing style")}
      </div>
    </section>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Advanced Settings",
          context,
          active: "settings",
          currentPath: "/app/settings/advanced",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/town", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.ownerUserId || !context.selectedBrandId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Local Network",
            context,
            active: "settings",
            currentPath: "/app/town",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Pick a business first.</p></section>`,
          }),
        );
    }
    const membership = await getTownMembershipForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
    });
    if (!membership) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Local Network",
            context,
            active: "settings",
            currentPath: "/app/town",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white">
              <h2 class="text-xl">Local Network</h2>
              <p class="muted">You are not in a town network yet.</p>
              <a class="secondary-button" href="${escapeHtml(withSelection("/app/settings", context))}">Open Settings</a>
            </section>`,
          }),
        );
    }
    const map = await getTownMapForUser({
      actorUserId: context.actorUserId,
      townId: membership.town.id,
    });
    const categoryLabels: Record<string, string> = {
      "loaded-tea": "Coffee",
      cafe: "Coffee",
      "fitness-hybrid": "Fitness",
      gym: "Fitness",
      retail: "Retail",
      restaurant: "Food",
      service: "Services",
      other: "Services",
    };
    const categories = (map?.categories ?? [])
      .map((entry) => categoryLabels[entry] ?? entry)
      .filter((entry, index, all) => all.indexOf(entry) === index)
      .join(" • ");
    const businessRows =
      map && map.businesses.length > 0
        ? map.businesses
            .map(
              (entry) =>
                `<li><strong>${escapeHtml(entry.name)}</strong> <span class="muted">(${escapeHtml(
                  categoryLabels[entry.type] ?? entry.type,
                )})</span></li>`,
            )
            .join("")
        : `<li class="muted">No participating businesses yet.</li>`;
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">We’re part of the ${escapeHtml(membership.town.name)} Local Network</h2>
      <p class="muted">Town Mode runs quietly in the background. No extra coordination required.</p>
      <p><strong>${escapeHtml(categories || "Local businesses")}</strong></p>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/pulse", context))}">View Town Pulse</a>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/stories", context))}" style="margin-top:8px;">View Town Stories</a>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/graph", context))}" style="margin-top:8px;">View Town Graph</a>
    </section>
    <section class="rounded-2xl p-6 shadow-sm bg-white">
      <h3>Participating businesses</h3>
      <ul>${businessRows}</ul>
    </section>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Local Network",
          context,
          active: "settings",
          currentPath: "/app/town",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/town/pulse", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.ownerUserId || !context.selectedBrandId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Town Pulse",
            context,
            active: "settings",
            currentPath: "/app/town/pulse",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Pick a business first.</p></section>`,
          }),
        );
    }
    const membership = await getTownMembershipForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
    });
    if (!membership) {
      return res.redirect(withNotice(withSelection("/app/settings", context), "Join Local Network first."));
    }
    const pulse = await getTownPulseModelForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
      recomputeIfMissing: true,
    });
    const model = pulse?.model;
    const dayLabel = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const windowsToText = (rows: Array<{ dow: number; hour: number }>) =>
      rows
        .slice(0, 3)
        .map((entry) => {
          const day = dayLabel[entry.dow] ?? "Day";
          const hour = `${String(entry.hour).padStart(2, "0")}:00`;
          return `${day} ${hour}`;
        })
        .join(" • ");
    const busySummary = model?.busyWindows?.length
      ? windowsToText(model.busyWindows)
      : "No strong peak yet — still learning local rhythm.";
    const slowSummary = model?.slowWindows?.length
      ? windowsToText(model.slowWindows)
      : "No major dip detected yet.";
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Town Pulse</h2>
      <p class="muted">Shared local rhythm, no private business data.</p>
      <p><strong>🟢 Town Pulse Active</strong> — ${escapeHtml(membership.town.name)}</p>
    </section>
    <section class="rounded-2xl p-6 shadow-sm bg-white">
      <p class="output-value"><strong>This town is often busiest:</strong><br/>${escapeHtml(busySummary)}</p>
      <p class="output-value"><strong>Midweek quieter windows:</strong><br/>${escapeHtml(slowSummary)}</p>
      <p class="muted">${escapeHtml(model?.seasonalNotes ?? "Seasonal rhythm will appear as more signals arrive.")}</p>
      <p class="muted">Event energy: ${escapeHtml(model?.eventEnergy ?? "low")}</p>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/stories", context))}" style="margin-top:8px;">View Town Stories</a>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/graph", context))}" style="margin-top:8px;">View Town Graph</a>
    </section>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Town Pulse",
          context,
          active: "settings",
          currentPath: "/app/town/pulse",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/town/graph", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.ownerUserId || !context.selectedBrandId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Town Graph",
            context,
            active: "settings",
            currentPath: "/app/town/graph",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Pick a business first.</p></section>`,
          }),
        );
    }
    const membership = await getTownMembershipForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
    });
    if (!membership) {
      return res.redirect(withNotice(withSelection("/app/settings", context), "Join Local Network first."));
    }
    const graph = await getTownGraph({
      townId: membership.town.id,
      userId: context.ownerUserId,
    });
    const edges = [...graph.edges].sort((a, b) => b.weight - a.weight);
    const edgeLines =
      edges.length > 0
        ? edges
            .slice(0, 6)
            .map((edge) => `${townGraphCategoryLabel(edge.from)} → ${townGraphCategoryLabel(edge.to)}`)
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")
        : `<li class="muted">Still learning local flow.</li>`;

    const first = edges[0];
    const chain: TownGraphCategory[] = [];
    if (first) {
      chain.push(first.from, first.to);
      while (chain.length < 4) {
        const last = chain[chain.length - 1];
        const next = edges.find((edge) => edge.from === last && !chain.includes(edge.to));
        if (!next) break;
        chain.push(next.to);
      }
    }
    const chainSummary =
      chain.length >= 2
        ? chain.map((category) => townGraphCategoryLabel(category)).join(" → ")
        : "Coffee / Cafe → Fitness → Salon / Beauty → Retail";
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Town Graph</h2>
      <p class="muted">Common local flow in ${escapeHtml(membership.town.name)}.</p>
      <p class="output-value"><strong>${escapeHtml(chainSummary)}</strong></p>
      <p class="muted">Category-level flow only. No private business metrics.</p>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/pulse", context))}" style="margin-top:8px;">View Town Pulse</a>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/stories", context))}" style="margin-top:8px;">View Town Stories</a>
    </section>
    <section class="rounded-2xl p-6 shadow-sm bg-white">
      <h3>Common local flow</h3>
      <ul>${edgeLines}</ul>
    </section>`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Town Graph",
          context,
          active: "settings",
          currentPath: "/app/town/graph",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.get("/town/stories", async (req, res, next) => {
  try {
    const context = await resolveContext(req, res);
    if (!context) {
      return;
    }
    if (!context.ownerUserId || !context.selectedBrandId) {
      return res
        .type("html")
        .send(
          easyLayout({
            title: "Town Stories",
            context,
            active: "settings",
            currentPath: "/app/town/stories",
            body: `<section class="rounded-2xl p-6 shadow-sm bg-white"><p class="muted">Pick a business first.</p></section>`,
          }),
        );
    }
    const membership = await getTownMembershipForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
    });
    if (!membership) {
      return res.redirect(withNotice(withSelection("/app/settings", context), "Join Local Network first."));
    }
    const story = await getLatestTownStoryForBrand({
      userId: context.ownerUserId,
      brandId: context.selectedBrandId,
    }).catch(() => null);
    const storyBody = story
      ? `<section class="rounded-2xl p-6 shadow-sm bg-white">
          <h3>${escapeHtml(story.content.headline)}</h3>
          <p class="output-value">${escapeHtml(story.content.summary)}</p>
          <p class="muted">How locals are supporting each other this week:</p>
          <p class="output-value">${escapeHtml(story.content.socialCaption)}</p>
          <p class="output-value">${escapeHtml(story.content.conversationStarter)}</p>
          <p class="output-value">${escapeHtml(story.content.signLine)}</p>
        </section>`
      : `<section class="rounded-2xl p-6 shadow-sm bg-white">
          <p class="muted">No town story yet. The next Town Stories cycle will generate one automatically.</p>
        </section>`;
    const body = `<section class="rounded-2xl p-6 shadow-sm bg-white">
      <h2 class="text-xl">Town Stories</h2>
      <p class="muted">A shared local narrative for ${escapeHtml(membership.town.name)}.</p>
      <p class="muted">No metrics. No rankings. Just warm community momentum.</p>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/pulse", context))}" style="margin-top:8px;">View Town Pulse</a>
      <a class="secondary-button" href="${escapeHtml(withSelection("/app/town/graph", context))}" style="margin-top:8px;">View Town Graph</a>
    </section>
    ${storyBody}`;
    return res
      .type("html")
      .send(
        easyLayout({
          title: "Town Stories",
          context,
          active: "settings",
          currentPath: "/app/town/stories",
          body,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

export default router;
