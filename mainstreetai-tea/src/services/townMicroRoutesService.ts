import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import type { DailyGoal } from "../schemas/dailyOneButtonSchema";
import {
  townGraphCategorySchema,
  townGraphEdgeSchema,
  townMicroRoutePathSchema,
  townMicroRoutePromptOutputSchema,
  townMicroRouteRowSchema,
  townMicroRouteRoutesSchema,
  type TownGraphCategory,
  type TownMicroRouteWindow,
} from "../schemas/townGraphSchema";
import { townPulseModelDataSchema, type TownPulseModelData } from "../schemas/townPulseSchema";
import { townRecordSchema, type TownRecord } from "../schemas/townSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import {
  addTownGraphEdge,
  listExplicitPartnersForBrand,
  listTownGraphEdges,
  townGraphCategoryFromBrandType,
  townGraphCategoryLabel,
} from "./townGraphService";
import { getTownPulseModel, listActiveTownPulseTargets } from "./townPulseService";
import {
  TOWN_MICRO_ROUTE_WINDOWS,
  doesWindowContainSlot,
  resolveTownWindow,
  townWindowLabel,
} from "../town/windows";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const MICRO_ROUTE_STALE_HOURS = 28;

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

type SupabaseMicroRouteRow = {
  id: string;
  town_ref: string;
  window: string;
  routes: unknown;
  computed_at: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(userId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(userId));
}

function localTownsPath(userId: string): string {
  return path.join(localUserDir(userId), "towns.json");
}

function localMicroRoutesPath(userId: string): string {
  return path.join(localUserDir(userId), "town_micro_routes.json");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function readLocalArray<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const parsed = z.array(schema).safeParse(await readJsonOrNull<unknown>(filePath));
  if (parsed.success) {
    return parsed.data;
  }
  return [];
}

function toTownRecord(row: SupabaseTownRow): TownRecord {
  return townRecordSchema.parse({
    id: row.id,
    name: row.name,
    region: row.region ?? undefined,
    timezone: row.timezone,
    createdAt: row.created_at,
  });
}

function toMicroRouteRow(row: SupabaseMicroRouteRow) {
  return townMicroRouteRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    window: row.window,
    routes: row.routes,
    computedAt: row.computed_at,
  });
}

function isStale(iso: string, maxAgeHours: number): boolean {
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return Date.now() - parsed > maxAgeHours * 60 * 60 * 1000;
}

function trendAsGraphCategory(category: string): TownGraphCategory {
  if (category === "mixed") {
    return "other";
  }
  const parsed = townGraphCategorySchema.safeParse(category);
  return parsed.success ? parsed.data : "other";
}

async function getTownById(input: { townId: string; userId?: string }): Promise<TownRecord | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("towns").select("*").eq("id", input.townId).maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toTownRecord(data as SupabaseTownRow);
  }
  if (!input.userId) {
    return null;
  }
  const rows = await readLocalArray(localTownsPath(input.userId), townRecordSchema);
  return rows.find((entry) => entry.id === input.townId) ?? null;
}

async function upsertMicroRouteRow(input: {
  townId: string;
  window: TownMicroRouteWindow;
  routes: z.infer<typeof townMicroRouteRoutesSchema>;
  userId?: string;
}): Promise<void> {
  const computedAt = new Date().toISOString();
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { error } = await table("town_micro_routes").upsert(
      {
        town_ref: input.townId,
        window: input.window,
        routes: input.routes,
        computed_at: computedAt,
      },
      { onConflict: "town_ref,window" },
    );
    if (error) {
      throw error;
    }
    return;
  }
  if (!input.userId) {
    return;
  }
  const filePath = localMicroRoutesPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townMicroRouteRowSchema);
  const index = rows.findIndex((row) => row.townRef === input.townId && row.window === input.window);
  const next = townMicroRouteRowSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    townRef: input.townId,
    window: input.window,
    routes: input.routes,
    computedAt,
  });
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(filePath, rows.slice(-1500));
}

export async function getTownMicroRoutesForWindow(input: {
  townId: string;
  window: TownMicroRouteWindow;
  userId?: string;
}) {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_micro_routes")
      .select("*")
      .eq("town_ref", input.townId)
      .eq("window", input.window)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toMicroRouteRow(data as SupabaseMicroRouteRow) : null;
  }
  if (!input.userId) {
    return null;
  }
  const rows = await readLocalArray(localMicroRoutesPath(input.userId), townMicroRouteRowSchema);
  return rows.find((entry) => entry.townRef === input.townId && entry.window === input.window) ?? null;
}

function busySlowCountsForWindow(input: {
  window: TownMicroRouteWindow;
  townPulse: TownPulseModelData | null;
}): { busyHits: number; slowHits: number } {
  if (!input.townPulse) {
    return { busyHits: 0, slowHits: 0 };
  }
  const busyHits = input.townPulse.busyWindows.filter((slot) =>
    doesWindowContainSlot({
      window: input.window,
      dayOfWeek: slot.dow,
      hour: slot.hour,
    }),
  ).length;
  const slowHits = input.townPulse.slowWindows.filter((slot) =>
    doesWindowContainSlot({
      window: input.window,
      dayOfWeek: slot.dow,
      hour: slot.hour,
    }),
  ).length;
  return { busyHits, slowHits };
}

function categoryTrendAdjust(route: TownGraphCategory[], townPulse: TownPulseModelData | null): number {
  if (!townPulse) {
    return 0;
  }
  const trendByCategory = new Map<TownGraphCategory, "up" | "steady" | "down">();
  for (const trend of townPulse.categoryTrends) {
    trendByCategory.set(trendAsGraphCategory(trend.category), trend.trend);
  }
  let adjust = 0;
  for (const category of route) {
    const trend = trendByCategory.get(category);
    if (!trend) continue;
    if (trend === "up") adjust += 0.45;
    else if (trend === "steady") adjust += 0.1;
    else adjust -= 0.2;
  }
  return adjust;
}

function buildWhy(window: TownMicroRouteWindow, busyHits: number, slowHits: number): string {
  const label = townWindowLabel(window).toLowerCase();
  if (window === "weekend") {
    return "Weekend downtown browsing loop with practical local stops.";
  }
  if (busyHits > slowHits) {
    return `Strong ${label} momentum and practical errand flow.`;
  }
  if (slowHits > 0) {
    return `${label} window with lighter pace and easy local sequence.`;
  }
  return `Natural ${label} stop sequence locals can follow.`;
}

function buildRouteCandidates(input: {
  edges: Array<{ from: TownGraphCategory; to: TownGraphCategory; weight: number }>;
  window: TownMicroRouteWindow;
  townPulse: TownPulseModelData | null;
}): Array<{ route: [TownGraphCategory, TownGraphCategory, TownGraphCategory]; why: string; weight: number }> {
  const outgoing = new Map<TownGraphCategory, Array<{ to: TownGraphCategory; weight: number }>>();
  for (const edge of input.edges) {
    const current = outgoing.get(edge.from) ?? [];
    current.push({ to: edge.to, weight: edge.weight });
    outgoing.set(edge.from, current);
  }
  for (const [from, list] of outgoing.entries()) {
    outgoing.set(
      from,
      [...list].sort((a, b) => b.weight - a.weight).slice(0, 6),
    );
  }

  const { busyHits, slowHits } = busySlowCountsForWindow({
    window: input.window,
    townPulse: input.townPulse,
  });

  const byKey = new Map<string, { route: [TownGraphCategory, TownGraphCategory, TownGraphCategory]; why: string; weight: number }>();
  for (const edge of input.edges) {
    const secondHops = outgoing.get(edge.to) ?? [];
    if (secondHops.length === 0) {
      const fallbackRoute: [TownGraphCategory, TownGraphCategory, TownGraphCategory] = [edge.from, edge.to, edge.to];
      const trendBoost = categoryTrendAdjust(fallbackRoute, input.townPulse);
      let adjusted = edge.weight + Math.max(0.2, edge.weight * 0.5) + trendBoost;
      if (busyHits > 0) adjusted *= 1 + Math.min(0.35, busyHits * 0.06);
      if (slowHits > 0) adjusted *= Math.max(0.6, 1 - Math.min(0.35, slowHits * 0.05));
      const key = fallbackRoute.join(">");
      const candidate = {
        route: fallbackRoute,
        why: buildWhy(input.window, busyHits, slowHits),
        weight: Math.max(0.01, Number(adjusted.toFixed(2))),
      };
      const existing = byKey.get(key);
      if (!existing || candidate.weight > existing.weight) {
        byKey.set(key, candidate);
      }
      continue;
    }
    for (const second of secondHops.slice(0, 4)) {
      const route: [TownGraphCategory, TownGraphCategory, TownGraphCategory] = [edge.from, edge.to, second.to];
      const trendBoost = categoryTrendAdjust(route, input.townPulse);
      let adjusted = edge.weight + second.weight + trendBoost;
      if (busyHits > 0) adjusted *= 1 + Math.min(0.4, busyHits * 0.07);
      if (slowHits > 0) adjusted *= Math.max(0.6, 1 - Math.min(0.35, slowHits * 0.05));
      const key = route.join(">");
      const candidate = {
        route,
        why: buildWhy(input.window, busyHits, slowHits),
        weight: Math.max(0.01, Number(adjusted.toFixed(2))),
      };
      const existing = byKey.get(key);
      if (!existing || candidate.weight > existing.weight) {
        byKey.set(key, candidate);
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.weight - a.weight);
}

async function routeStatus(input: { townId: string; userId?: string }): Promise<{ count: number; latest: string | null }> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_micro_routes")
      .select("window, computed_at")
      .eq("town_ref", input.townId)
      .order("computed_at", { ascending: false });
    if (error) {
      throw error;
    }
    const rows = (data ?? []) as Array<{ computed_at?: string | null }>;
    return {
      count: rows.length,
      latest: typeof rows[0]?.computed_at === "string" ? rows[0].computed_at : null,
    };
  }
  if (!input.userId) {
    return { count: 0, latest: null };
  }
  const rows = await readLocalArray(localMicroRoutesPath(input.userId), townMicroRouteRowSchema);
  const filtered = rows
    .filter((row) => row.townRef === input.townId)
    .sort((a, b) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
  return {
    count: filtered.length,
    latest: filtered[0]?.computedAt ?? null,
  };
}

async function listAdditionalSupabaseTownsWithGraph(limit: number): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("town_graph_edges")
    .select("town_ref, updated_at")
    .order("updated_at", { ascending: false })
    .limit(Math.max(limit * 4, 40));
  if (error) {
    throw error;
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of (data ?? []) as Array<{ town_ref?: string | null }>) {
    const townId = typeof row.town_ref === "string" ? row.town_ref : "";
    if (!townId || seen.has(townId)) continue;
    seen.add(townId);
    ids.push(townId);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function listLocalUsersWithGraphEdges(): Promise<Array<{ townId: string; userId: string; latest: string }>> {
  let userDirs: string[];
  try {
    const entries = await readdir(LOCAL_ROOT, { withFileTypes: true });
    userDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const rows: Array<{ townId: string; userId: string; latest: string }> = [];
  for (const userDir of userDirs) {
    const edges = await readLocalArray(path.join(LOCAL_ROOT, userDir, "town_graph_edges.json"), townGraphEdgeSchema);
    const latestByTown = new Map<string, string>();
    for (const edge of edges) {
      const latest = latestByTown.get(edge.townRef);
      if (!latest || new Date(edge.updatedAt).getTime() > new Date(latest).getTime()) {
        latestByTown.set(edge.townRef, edge.updatedAt);
      }
    }
    for (const [townId, latest] of latestByTown.entries()) {
      rows.push({
        townId,
        userId: userDir,
        latest,
      });
    }
  }
  return rows;
}

export async function listDueTownMicroRouteTargets(limit = 20): Promise<Array<{ townId: string; userId?: string }>> {
  const max = Math.max(1, Math.min(100, limit));
  const candidates: Array<{ townId: string; userId?: string }> = [];
  const seen = new Set<string>();

  const pulseTargets = await listActiveTownPulseTargets(max * 3);
  for (const target of pulseTargets) {
    if (seen.has(target.townId)) continue;
    seen.add(target.townId);
    candidates.push(target);
  }

  if (getStorageMode() === "supabase") {
    const extra = await listAdditionalSupabaseTownsWithGraph(max * 2);
    for (const townId of extra) {
      if (seen.has(townId)) continue;
      seen.add(townId);
      candidates.push({ townId });
    }
  } else {
    const local = await listLocalUsersWithGraphEdges();
    for (const row of local.sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime())) {
      const key = `${row.userId}:${row.townId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ townId: row.townId, userId: row.userId });
    }
  }

  const due: Array<{ townId: string; userId?: string }> = [];
  for (const candidate of candidates) {
    const status = await routeStatus({
      townId: candidate.townId,
      userId: candidate.userId,
    });
    if (
      status.count < TOWN_MICRO_ROUTE_WINDOWS.length ||
      !status.latest ||
      isStale(status.latest, MICRO_ROUTE_STALE_HOURS)
    ) {
      due.push(candidate);
    }
    if (due.length >= max) break;
  }
  return due;
}

export async function recomputeTownMicroRoutesForTown(input: {
  townId: string;
  userId?: string;
}): Promise<{ updated: number }> {
  const edges = await listTownGraphEdges({
    townId: input.townId,
    userId: input.userId,
  });
  const pulseModel = await getTownPulseModel({
    townId: input.townId,
    userId: input.userId,
  }).catch(() => null);
  const pulse = pulseModel?.model ?? null;
  let updated = 0;
  for (const window of TOWN_MICRO_ROUTE_WINDOWS) {
    const candidates = buildRouteCandidates({
      edges: edges.map((edge) => ({
        from: edge.fromCategory,
        to: edge.toCategory,
        weight: edge.weight,
      })),
      window,
      townPulse: pulse,
    })
      .slice(0, 8)
      .map((candidate) => townMicroRoutePathSchema.parse(candidate));
    await upsertMicroRouteRow({
      townId: input.townId,
      window,
      routes: townMicroRouteRoutesSchema.parse({
        topRoutes: candidates,
      }),
      userId: input.userId,
    });
    updated += 1;
  }
  return { updated };
}

async function getOrRecomputeWindowRoutes(input: {
  townId: string;
  window: TownMicroRouteWindow;
  userId?: string;
}) {
  let row = await getTownMicroRoutesForWindow({
    townId: input.townId,
    window: input.window,
    userId: input.userId,
  });
  if (!row || isStale(row.computedAt, MICRO_ROUTE_STALE_HOURS)) {
    await recomputeTownMicroRoutesForTown({
      townId: input.townId,
      userId: input.userId,
    });
    row = await getTownMicroRoutesForWindow({
      townId: input.townId,
      window: input.window,
      userId: input.userId,
    });
  }
  return row;
}

function defaultTownPulse(): TownPulseModelData {
  return townPulseModelDataSchema.parse({
    busyWindows: [],
    slowWindows: [],
    eventEnergy: "low",
    seasonalNotes: "Town rhythm is still warming up.",
    categoryTrends: [],
  });
}

function fallbackMicroRouteLine(input: {
  window: TownMicroRouteWindow;
  route: TownGraphCategory[];
}): {
  line: string;
  captionAddOn: string;
  staffLine: string;
} {
  const first = townGraphCategoryLabel(input.route[0] ?? "other");
  const second = townGraphCategoryLabel(input.route[1] ?? "other");
  const third = townGraphCategoryLabel(input.route[2] ?? "other");
  const window = townWindowLabel(input.window);
  return {
    line: `${window} flow: ${first} -> ${second} -> ${third}.`,
    captionAddOn: `Try a simple ${window.toLowerCase()} route with nearby local stops.`,
    staffLine: `If guests ask what to do next, suggest a ${window.toLowerCase()} local route.`,
  };
}

function adjustTopRoutesForGoal(input: {
  topRoutes: z.infer<typeof townMicroRoutePathSchema>[];
  goal: DailyGoal;
  window: TownMicroRouteWindow;
  townPulse: TownPulseModelData;
}): z.infer<typeof townMicroRoutePathSchema>[] {
  if (input.goal !== "slow_hours") {
    return input.topRoutes;
  }
  const slowHits = input.townPulse.slowWindows.filter((slot) =>
    doesWindowContainSlot({
      window: input.window,
      dayOfWeek: slot.dow,
      hour: slot.hour,
    }),
  ).length;
  if (slowHits === 0) {
    return input.topRoutes;
  }
  const trendByCategory = new Map<TownGraphCategory, "up" | "steady" | "down">();
  for (const trend of input.townPulse.categoryTrends) {
    trendByCategory.set(trendAsGraphCategory(trend.category), trend.trend);
  }
  return input.topRoutes
    .map((route) => {
      let weight = route.weight + slowHits * 0.45;
      for (const category of route.route) {
        const trend = trendByCategory.get(category);
        if (trend === "down") weight += 0.25;
        if (trend === "steady") weight += 0.08;
      }
      return townMicroRoutePathSchema.parse({
        ...route,
        weight: Number(weight.toFixed(2)),
        why: `${route.why} Tuned for slower-window opportunity.`,
      });
    })
    .sort((a, b) => b.weight - a.weight);
}

export async function buildTownMicroRouteForDaily(input: {
  userId: string;
  brandId: string;
  brand: BrandProfile;
  goal: DailyGoal;
  timezone: string;
  townPulse?: TownPulseModelData | null;
  windowOverride?: TownMicroRouteWindow;
}): Promise<{
  townMicroRoute: {
    window: TownMicroRouteWindow;
    line: string;
    captionAddOn: string;
    staffScript: string;
  };
} | null> {
  if (!input.brand.townRef) {
    return null;
  }
  const window = resolveTownWindow({
    timezone: input.timezone,
    override: input.windowOverride,
    preferUpcoming: true,
  });
  const routeRow = await getOrRecomputeWindowRoutes({
    townId: input.brand.townRef,
    window,
    userId: input.userId,
  });
  if (!routeRow || routeRow.routes.topRoutes.length === 0) {
    return null;
  }
  const town = await getTownById({
    townId: input.brand.townRef,
    userId: input.userId,
  });
  if (!town) {
    return null;
  }
  const townPulse = input.townPulse ?? defaultTownPulse();
  const topRoutes = adjustTopRoutesForGoal({
    topRoutes: routeRow.routes.topRoutes,
    goal: input.goal,
    window,
    townPulse,
  });
  const explicitPartners = await listExplicitPartnersForBrand({
    userId: input.userId,
    brandId: input.brandId,
  }).catch(() => []);

  const promptOutput = await runPrompt({
    promptFile: "town_micro_route_suggest.md",
    brandProfile: input.brand,
    userId: input.userId,
    input: {
      brand: input.brand,
      town: {
        id: town.id,
        name: town.name,
        region: town.region ?? null,
        timezone: town.timezone,
      },
      window,
      topRoutes,
      townPulse,
      goal: input.goal,
      explicitPartners,
    },
    outputSchema: townMicroRoutePromptOutputSchema,
  }).catch(() => {
    const first = topRoutes[0];
    const fallback = fallbackMicroRouteLine({
      window,
      route: first?.route ?? ["other", "other", "other"],
    });
    return townMicroRoutePromptOutputSchema.parse({
      microRouteLine: fallback.line,
      captionAddOn: fallback.captionAddOn,
      staffLine: fallback.staffLine,
      optionalCollabCategory: first?.route[1] ?? "other",
    });
  });

  const fromCategory = townGraphCategoryFromBrandType(input.brand.type);
  const optionalCategory = promptOutput.optionalCollabCategory;
  if (optionalCategory && optionalCategory !== fromCategory) {
    await addTownGraphEdge({
      townId: input.brand.townRef,
      fromCategory,
      toCategory: optionalCategory,
      weight: 0.65,
      userId: input.userId,
    }).catch(() => {
      // Micro-route learning should not block daily pack generation.
    });
  }

  return {
    townMicroRoute: {
      window,
      line: promptOutput.microRouteLine,
      captionAddOn: promptOutput.captionAddOn,
      staffScript: promptOutput.staffLine,
    },
  };
}
