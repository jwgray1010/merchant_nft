import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import type { DailyGoal } from "../schemas/dailyOneButtonSchema";
import type { MetricsRequest } from "../schemas/metricsSchema";
import {
  townPulseModelDataSchema,
  townPulseModelRowSchema,
  townPulsePromptOutputSchema,
  townPulseSignalSchema,
  type TownPulseCategory,
  type TownPulseModelData,
  type TownPulseModelRow,
  type TownPulsePromptOutput,
  type TownPulseSignalType,
} from "../schemas/townPulseSchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const MODEL_STALE_HOURS = 24;

type SupabaseTownRow = {
  id: string;
  timezone: string;
};

type SupabaseSignalRow = {
  id: string;
  town_ref: string;
  category: string;
  signal_type: string;
  day_of_week: number | null;
  hour: number | null;
  weight: number;
  created_at: string;
};

type SupabaseModelRow = {
  id: string;
  town_ref: string;
  model: unknown;
  computed_at: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(userId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(userId));
}

function localSignalPath(userId: string): string {
  return path.join(localUserDir(userId), "town_pulse_signals.json");
}

function localModelPath(userId: string): string {
  return path.join(localUserDir(userId), "town_pulse_models.json");
}

function localTownsPath(userId: string): string {
  return path.join(localUserDir(userId), "towns.json");
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

async function readLocalArray<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const parsed = z.array(schema).safeParse(await readJsonOrNull<unknown>(filePath));
  if (parsed.success) {
    return parsed.data;
  }
  return [];
}

function toTownPulseSignal(row: SupabaseSignalRow) {
  return townPulseSignalSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    category: row.category,
    signalType: row.signal_type,
    dayOfWeek: row.day_of_week ?? undefined,
    hour: row.hour ?? undefined,
    weight: Number(row.weight ?? 1),
    createdAt: row.created_at,
  });
}

function toTownPulseModelRow(row: SupabaseModelRow): TownPulseModelRow {
  return townPulseModelRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    model: row.model,
    computedAt: row.computed_at,
  });
}

function toWeight(value: number | undefined, fallback = 1): number {
  const candidate = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(0.05, Math.min(50, candidate));
}

function currentMonthSeasonNote(now = new Date()): string {
  const month = now.getUTCMonth() + 1;
  if (month >= 11 || month <= 1) {
    return "Holiday season can amplify weekend and evening momentum.";
  }
  if (month >= 2 && month <= 4) {
    return "Spring routines often lift weekday stop-ins and after-work traffic.";
  }
  if (month >= 5 && month <= 8) {
    return "Summer schedules can shift traffic toward afternoons and weekends.";
  }
  return "Fall community rhythms can increase event-driven local activity.";
}

function dayOfWeekFromShort(weekday: string): number {
  const key = weekday.trim().toLowerCase().slice(0, 3);
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return map[key] ?? 0;
}

function resolveDayHour(iso: string, timezone: string): { dayOfWeek: number; hour: number } {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return { dayOfWeek: 0, hour: 12 };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date);
  const weekday = parts.find((entry) => entry.type === "weekday")?.value ?? "sun";
  const hourRaw = parts.find((entry) => entry.type === "hour")?.value ?? "12";
  const hour = Number.parseInt(hourRaw, 10);
  return {
    dayOfWeek: dayOfWeekFromShort(weekday),
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 12,
  };
}

async function getTownTimezone(input: { townRef: string; userId?: string }): Promise<string> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("towns").select("id, timezone").eq("id", input.townRef).maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data as SupabaseTownRow | null) ?? null;
    return row?.timezone || "America/Chicago";
  }
  if (!input.userId) {
    return "America/Chicago";
  }
  const townsRaw = await readJsonOrNull<unknown>(localTownsPath(input.userId));
  const towns = Array.isArray(townsRaw) ? townsRaw : [];
  const matched = towns.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { id?: unknown }).id === input.townRef,
  ) as { timezone?: unknown } | undefined;
  return typeof matched?.timezone === "string" && matched.timezone.trim() !== ""
    ? matched.timezone
    : "America/Chicago";
}

export function townPulseCategoryFromBrandType(type: string): TownPulseCategory {
  const normalized = type.trim().toLowerCase();
  if (normalized === "cafe" || normalized === "loaded-tea") return "cafe";
  if (normalized === "fitness-hybrid" || normalized === "gym") return "fitness";
  if (normalized === "restaurant") return "food";
  if (normalized === "retail") return "retail";
  if (normalized === "salon") return "salon";
  if (normalized === "service" || normalized === "barber" || normalized === "auto") return "service";
  return "mixed";
}

export async function recordTownPulseSignals(input: {
  userId?: string;
  townRef: string | undefined;
  category: TownPulseCategory;
  signals: Array<{
    signalType: TownPulseSignalType;
    weight?: number;
    occurredAt?: string;
  }>;
}): Promise<number> {
  if (!input.townRef || input.signals.length === 0) {
    return 0;
  }
  const timezone = await getTownTimezone({
    townRef: input.townRef,
    userId: input.userId,
  });
  const nowIso = new Date().toISOString();
  const rows = input.signals.map((signal) => {
    const occurredAt = signal.occurredAt ?? nowIso;
    const slot = resolveDayHour(occurredAt, timezone);
    return {
      id: randomUUID(),
      townRef: input.townRef as string,
      category: input.category,
      signalType: signal.signalType,
      dayOfWeek: slot.dayOfWeek,
      hour: slot.hour,
      weight: toWeight(signal.weight, 1),
      createdAt: occurredAt,
    };
  });

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const payload = rows.map((row) => ({
      town_ref: row.townRef,
      category: row.category,
      signal_type: row.signalType,
      day_of_week: row.dayOfWeek,
      hour: row.hour,
      weight: row.weight,
      created_at: row.createdAt,
    }));
    const { error } = await table("town_pulse_signals").insert(payload);
    if (error) {
      throw error;
    }
    return rows.length;
  }

  const userId = input.userId;
  if (!userId) {
    return 0;
  }
  const filePath = localSignalPath(userId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray<ReturnType<typeof townPulseSignalSchema.parse>>(
    filePath,
    townPulseSignalSchema,
  );
  const merged = existing.concat(rows.map((row) => townPulseSignalSchema.parse(row)));
  await atomicWriteJson(filePath, merged);
  return rows.length;
}

function metricEngagementScore(metrics: MetricsRequest): number {
  return (
    (metrics.views ?? 0) / 100 +
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) * 2 +
    (metrics.shares ?? 0) * 3 +
    (metrics.saves ?? 0) * 2 +
    (metrics.clicks ?? 0) * 2 +
    (metrics.redemptions ?? 0) * 4
  );
}

export async function recordTownPulseFromMetrics(input: {
  userId: string;
  brand: BrandProfile | null;
  metrics: MetricsRequest;
  occurredAt?: string;
}): Promise<number> {
  if (!input.brand?.townRef) {
    return 0;
  }
  const category = townPulseCategoryFromBrandType(input.brand.type);
  const notes = (input.metrics.salesNotes ?? "").toLowerCase();
  const signals: Array<{ signalType: TownPulseSignalType; weight?: number; occurredAt?: string }> = [];

  if (notes.includes("busy")) {
    signals.push({ signalType: "busy", weight: 1.2, occurredAt: input.occurredAt });
  }
  if (notes.includes("slow")) {
    signals.push({ signalType: "slow", weight: 1.2, occurredAt: input.occurredAt });
  }
  if ((input.metrics.redemptions ?? 0) >= 3) {
    signals.push({ signalType: "busy", weight: 1.1, occurredAt: input.occurredAt });
  }
  const engagement = metricEngagementScore(input.metrics);
  if (engagement > 0) {
    const weight = engagement >= 12 ? 1.3 : engagement >= 4 ? 0.9 : 0.35;
    signals.push({ signalType: "post_success", weight, occurredAt: input.occurredAt });
  }
  if (signals.length === 0) {
    signals.push({ signalType: "post_success", weight: 0.4, occurredAt: input.occurredAt });
  }

  return recordTownPulseSignals({
    userId: input.userId,
    townRef: input.brand.townRef,
    category,
    signals,
  });
}

async function readSignalsForTown(input: {
  townId: string;
  rangeDays: number;
  userId?: string;
}): Promise<Array<ReturnType<typeof townPulseSignalSchema.parse>>> {
  const cutoffMs = Date.now() - input.rangeDays * 24 * 60 * 60 * 1000;
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_pulse_signals")
      .select("*")
      .eq("town_ref", input.townId)
      .gte("created_at", new Date(cutoffMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(6000);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseSignalRow[]).map(toTownPulseSignal);
  }
  if (!input.userId) {
    return [];
  }
  const rows = await readLocalArray<ReturnType<typeof townPulseSignalSchema.parse>>(
    localSignalPath(input.userId),
    townPulseSignalSchema,
  );
  return rows.filter((entry) => {
    if (entry.townRef !== input.townId) {
      return false;
    }
    const createdMs = new Date(entry.createdAt).getTime();
    return Number.isFinite(createdMs) && createdMs >= cutoffMs;
  });
}

function buildTownPulseModel(signals: Array<ReturnType<typeof townPulseSignalSchema.parse>>): TownPulseModelData {
  const slotScores = new Map<string, { dow: number; hour: number; busy: number; slow: number }>();
  const categoryWeight = new Map<TownPulseCategory, number>();
  let eventSpikeRecent = 0;
  const recentEventCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const signal of signals) {
    const dow = signal.dayOfWeek ?? 0;
    const hour = signal.hour ?? 12;
    const key = `${dow}-${hour}`;
    const existing = slotScores.get(key) ?? { dow, hour, busy: 0, slow: 0 };
    if (signal.signalType === "busy") {
      existing.busy += signal.weight;
    } else if (signal.signalType === "slow") {
      existing.slow += signal.weight;
    } else if (signal.signalType === "post_success") {
      existing.busy += signal.weight * 0.7;
    } else if (signal.signalType === "event_spike") {
      existing.busy += signal.weight * 0.85;
      const createdMs = new Date(signal.createdAt).getTime();
      if (Number.isFinite(createdMs) && createdMs >= recentEventCutoff) {
        eventSpikeRecent += signal.weight;
      }
    }
    slotScores.set(key, existing);
    const categoryTotal = categoryWeight.get(signal.category) ?? 0;
    categoryWeight.set(signal.category, categoryTotal + signal.weight);
  }

  const rows = [...slotScores.values()];
  const busyWindows = rows
    .map((row) => ({ dow: row.dow, hour: row.hour, score: row.busy - row.slow }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => ({ dow: row.dow, hour: row.hour }));
  const slowWindows = rows
    .map((row) => ({ dow: row.dow, hour: row.hour, score: row.slow - row.busy }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => ({ dow: row.dow, hour: row.hour }));
  const categoryTrends = [...categoryWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, weight]) => ({
      category,
      trend: weight >= 8 ? ("up" as const) : weight >= 3 ? ("steady" as const) : ("down" as const),
    }));
  const eventEnergy = eventSpikeRecent >= 8 ? "high" : eventSpikeRecent >= 2 ? "medium" : "low";
  return townPulseModelDataSchema.parse({
    busyWindows,
    slowWindows,
    eventEnergy,
    seasonalNotes: currentMonthSeasonNote(),
    categoryTrends,
  });
}

export async function recomputeTownPulseModel(input: {
  townId: string;
  rangeDays?: number;
  userId?: string;
}): Promise<TownPulseModelRow> {
  const rangeDays = Math.max(7, Math.min(90, input.rangeDays ?? 45));
  const signals = await readSignalsForTown({
    townId: input.townId,
    rangeDays,
    userId: input.userId,
  });
  const model = buildTownPulseModel(signals);
  const nowIso = new Date().toISOString();

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_pulse_model")
      .upsert(
        {
          town_ref: input.townId,
          model,
          computed_at: nowIso,
        },
        { onConflict: "town_ref" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownPulseModelRow(data as SupabaseModelRow);
  }

  const userId = input.userId;
  if (!userId) {
    throw new Error("userId is required to recompute local town pulse model");
  }
  const filePath = localModelPath(userId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray<ReturnType<typeof townPulseModelRowSchema.parse>>(
    filePath,
    townPulseModelRowSchema,
  );
  const index = existing.findIndex((entry) => entry.townRef === input.townId);
  const next = townPulseModelRowSchema.parse({
    id: index >= 0 ? existing[index].id : randomUUID(),
    townRef: input.townId,
    model,
    computedAt: nowIso,
  });
  if (index >= 0) {
    existing[index] = next;
  } else {
    existing.push(next);
  }
  await atomicWriteJson(filePath, existing);
  return next;
}

function isStale(iso: string, maxAgeHours: number): boolean {
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return Date.now() - parsed > maxAgeHours * 60 * 60 * 1000;
}

export async function getTownPulseModel(input: {
  townId: string;
  userId?: string;
}): Promise<TownPulseModelRow | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_pulse_model")
      .select("*")
      .eq("town_ref", input.townId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toTownPulseModelRow(data as SupabaseModelRow) : null;
  }
  if (!input.userId) {
    return null;
  }
  const rows = await readLocalArray<ReturnType<typeof townPulseModelRowSchema.parse>>(
    localModelPath(input.userId),
    townPulseModelRowSchema,
  );
  return rows.find((entry) => entry.townRef === input.townId) ?? null;
}

export async function getTownPulseModelForBrand(input: {
  userId: string;
  brandId: string;
  recomputeIfMissing?: boolean;
}): Promise<{ townId: string; model: TownPulseModelData; computedAt: string } | null> {
  const brand = await getAdapter().getBrand(input.userId, input.brandId);
  if (!brand?.townRef) {
    return null;
  }
  let modelRow = await getTownPulseModel({
    townId: brand.townRef,
    userId: input.userId,
  });
  if (
    input.recomputeIfMissing &&
    (!modelRow || isStale(modelRow.computedAt, MODEL_STALE_HOURS))
  ) {
    modelRow = await recomputeTownPulseModel({
      townId: brand.townRef,
      userId: input.userId,
      rangeDays: 45,
    });
  }
  if (!modelRow) {
    return null;
  }
  return {
    townId: modelRow.townRef,
    model: modelRow.model,
    computedAt: modelRow.computedAt,
  };
}

export async function writeTownPulseSignalForBrand(input: {
  userId: string;
  brand: BrandProfile | null;
  signalType: TownPulseSignalType;
  weight?: number;
  occurredAt?: string;
}): Promise<number> {
  if (!input.brand?.townRef) {
    return 0;
  }
  return recordTownPulseSignals({
    userId: input.userId,
    townRef: input.brand.townRef,
    category: townPulseCategoryFromBrandType(input.brand.type),
    signals: [
      {
        signalType: input.signalType,
        weight: input.weight,
        occurredAt: input.occurredAt,
      },
    ],
  });
}

export async function writeTownPulseForDailyOutcome(input: {
  userId: string;
  brand: BrandProfile | null;
  outcome: "slow" | "okay" | "busy";
  occurredAt?: string;
}): Promise<number> {
  if (!input.brand?.townRef) {
    return 0;
  }
  if (input.outcome === "busy") {
    return writeTownPulseSignalForBrand({
      userId: input.userId,
      brand: input.brand,
      signalType: "busy",
      weight: 1.2,
      occurredAt: input.occurredAt,
    });
  }
  if (input.outcome === "slow") {
    return writeTownPulseSignalForBrand({
      userId: input.userId,
      brand: input.brand,
      signalType: "slow",
      weight: 1.2,
      occurredAt: input.occurredAt,
    });
  }
  return recordTownPulseSignals({
    userId: input.userId,
    townRef: input.brand.townRef,
    category: townPulseCategoryFromBrandType(input.brand.type),
    signals: [
      { signalType: "busy", weight: 0.35, occurredAt: input.occurredAt },
      { signalType: "slow", weight: 0.2, occurredAt: input.occurredAt },
    ],
  });
}

export async function writeTownPulseForAutopilot(input: {
  userId: string;
  brand: BrandProfile | null;
  goal: DailyGoal;
  hadUpcomingEvents: boolean;
  occurredAt?: string;
}): Promise<number> {
  if (!input.brand?.townRef) {
    return 0;
  }
  const signals: Array<{ signalType: TownPulseSignalType; weight?: number; occurredAt?: string }> = [
    { signalType: "post_success", weight: 0.6, occurredAt: input.occurredAt },
  ];
  if (input.hadUpcomingEvents) {
    signals.push({ signalType: "event_spike", weight: 0.9, occurredAt: input.occurredAt });
  }
  if (input.goal === "slow_hours") {
    signals.push({ signalType: "slow", weight: 0.45, occurredAt: input.occurredAt });
  }
  return recordTownPulseSignals({
    userId: input.userId,
    townRef: input.brand.townRef,
    category: townPulseCategoryFromBrandType(input.brand.type),
    signals,
  });
}

export async function buildTownPulsePromptSuggestion(input: {
  userId: string;
  brand: BrandProfile;
  townPulse: TownPulseModelData;
}): Promise<TownPulsePromptOutput> {
  return runPrompt({
    promptFile: "town_pulse.md",
    brandProfile: input.brand,
    userId: input.userId,
    input: {
      brand: input.brand,
      townPulse: input.townPulse,
    },
    outputSchema: townPulsePromptOutputSchema,
  });
}

async function listLocalUsersWithSignals(): Promise<Array<{ userId: string; latest: string; townId: string }>> {
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

  const rows: Array<{ userId: string; latest: string; townId: string }> = [];
  for (const userDir of userDirs) {
    const signals = await readLocalArray<ReturnType<typeof townPulseSignalSchema.parse>>(
      path.join(LOCAL_ROOT, userDir, "town_pulse_signals.json"),
      townPulseSignalSchema,
    );
    const latestByTown = new Map<string, string>();
    for (const signal of signals) {
      const latest = latestByTown.get(signal.townRef);
      if (!latest || new Date(signal.createdAt).getTime() > new Date(latest).getTime()) {
        latestByTown.set(signal.townRef, signal.createdAt);
      }
    }
    for (const [townId, latest] of latestByTown.entries()) {
      rows.push({
        userId: userDir,
        townId,
        latest,
      });
    }
  }
  return rows;
}

export async function listActiveTownPulseTargets(limit = 20): Promise<
  Array<{
    townId: string;
    userId?: string;
  }>
> {
  const max = Math.max(1, Math.min(100, limit));
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_pulse_signals")
      .select("town_ref, created_at")
      .order("created_at", { ascending: false })
      .limit(4000);
    if (error) {
      throw error;
    }
    const seen = new Set<string>();
    const targets: Array<{ townId: string; userId?: string }> = [];
    for (const row of (data ?? []) as Array<{ town_ref?: string | null }>) {
      const townRef = typeof row.town_ref === "string" ? row.town_ref : "";
      if (!townRef || seen.has(townRef)) {
        continue;
      }
      seen.add(townRef);
      targets.push({ townId: townRef });
      if (targets.length >= max) {
        break;
      }
    }
    return targets;
  }

  const rows = await listLocalUsersWithSignals();
  return rows
    .sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime())
    .slice(0, max)
    .map((row) => ({
      townId: row.townId,
      userId: row.userId,
    }));
}
