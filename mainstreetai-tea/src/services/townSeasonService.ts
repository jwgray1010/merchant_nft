import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type TownGraphCategory, type TownMicroRouteWindow } from "../schemas/townGraphSchema";
import {
  townRouteSeasonWeightRowSchema,
  townSeasonRowSchema,
  type TownSeasonKey,
} from "../schemas/townSeasonSchema";
import { townRecordSchema, type TownRecord } from "../schemas/townSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { detectTownSeasonState } from "../town/seasonDetector";
import { listActiveTownPulseTargets } from "./townPulseService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

type SupabaseTownSeasonRow = {
  id: string;
  town_ref: string;
  season_key: string;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
};

type SupabaseTownRouteSeasonWeightRow = {
  id: string;
  town_ref: string;
  season_tag: string;
  window: string;
  from_category: string;
  to_category: string;
  weight_delta: number;
  created_at: string;
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

function localTownSeasonsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_seasons.json");
}

function localTownRouteSeasonWeightsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_route_season_weights.json");
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

function toTownSeasonRow(row: SupabaseTownSeasonRow) {
  return townSeasonRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    seasonKey: row.season_key,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    createdAt: row.created_at,
  });
}

function toTownRouteSeasonWeightRow(row: SupabaseTownRouteSeasonWeightRow) {
  return townRouteSeasonWeightRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    seasonTag: row.season_tag,
    window: row.window,
    fromCategory: row.from_category,
    toCategory: row.to_category,
    weightDelta: Number(row.weight_delta ?? 1),
    createdAt: row.created_at,
  });
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

export async function listTownSeasons(input: {
  townId: string;
  userId?: string;
}) {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_seasons")
      .select("*")
      .eq("town_ref", input.townId)
      .order("season_key", { ascending: true });
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownSeasonRow[]).map(toTownSeasonRow);
  }
  if (!input.userId) {
    return [];
  }
  const rows = await readLocalArray(localTownSeasonsPath(input.userId), townSeasonRowSchema);
  return rows
    .filter((row) => row.townRef === input.townId)
    .sort((a, b) => a.seasonKey.localeCompare(b.seasonKey));
}

export async function upsertTownSeason(input: {
  townId: string;
  seasonKey: TownSeasonKey;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  const startDate = input.startDate?.trim() ? input.startDate.trim() : null;
  const endDate = input.endDate?.trim() ? input.endDate.trim() : null;
  const notes = input.notes?.trim() ? input.notes.trim() : null;

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_seasons")
      .upsert(
        {
          town_ref: input.townId,
          season_key: input.seasonKey,
          start_date: startDate,
          end_date: endDate,
          notes,
        },
        { onConflict: "town_ref,season_key" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownSeasonRow(data as SupabaseTownSeasonRow);
  }

  if (!input.userId) {
    throw new Error("userId is required in local mode");
  }
  const filePath = localTownSeasonsPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townSeasonRowSchema);
  const index = rows.findIndex((row) => row.townRef === input.townId && row.seasonKey === input.seasonKey);
  const next = townSeasonRowSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    townRef: input.townId,
    seasonKey: input.seasonKey,
    startDate,
    endDate,
    notes,
    createdAt: index >= 0 ? rows[index].createdAt : new Date().toISOString(),
  });
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(filePath, rows.slice(-2000));
  return next;
}

export async function deleteTownSeason(input: {
  townId: string;
  seasonKey: TownSeasonKey;
  userId?: string;
}): Promise<boolean> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { error } = await table("town_seasons")
      .delete()
      .eq("town_ref", input.townId)
      .eq("season_key", input.seasonKey);
    if (error) {
      throw error;
    }
    return true;
  }
  if (!input.userId) {
    return false;
  }
  const filePath = localTownSeasonsPath(input.userId);
  const rows = await readLocalArray(filePath, townSeasonRowSchema);
  const next = rows.filter((row) => !(row.townRef === input.townId && row.seasonKey === input.seasonKey));
  if (next.length === rows.length) {
    return false;
  }
  await ensureDir(path.dirname(filePath));
  await atomicWriteJson(filePath, next);
  return true;
}

export async function listTownRouteSeasonWeights(input: {
  townId: string;
  window?: TownMicroRouteWindow;
  userId?: string;
}) {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    let query = table("town_route_season_weights").select("*").eq("town_ref", input.townId);
    if (input.window) {
      query = query.eq("window", input.window);
    }
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownRouteSeasonWeightRow[]).map(toTownRouteSeasonWeightRow);
  }
  if (!input.userId) {
    return [];
  }
  const rows = await readLocalArray(localTownRouteSeasonWeightsPath(input.userId), townRouteSeasonWeightRowSchema);
  return rows
    .filter((row) => row.townRef === input.townId && (!input.window || row.window === input.window))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function resolveTownSeasonStateForTown(input: {
  townId: string;
  userId?: string;
  overrideSeason?: TownSeasonKey;
  now?: Date;
}) {
  const town = await getTownById({
    townId: input.townId,
    userId: input.userId,
  });
  if (!town) {
    return null;
  }
  const customSeasons = await listTownSeasons({
    townId: input.townId,
    userId: input.userId,
  });
  const detected = detectTownSeasonState({
    timezone: town.timezone,
    now: input.now,
    overrideSeason: input.overrideSeason,
    customSeasons: customSeasons.map((row) => ({
      seasonKey: row.seasonKey,
      startDate: row.startDate,
      endDate: row.endDate,
      notes: row.notes,
    })),
  });
  return {
    town,
    detected,
    customSeasons,
  };
}

export function applySeasonWeightDeltasToEdges(input: {
  edges: Array<{ from: TownGraphCategory; to: TownGraphCategory; weight: number }>;
  seasonWeights: Array<{
    seasonTag: TownSeasonKey;
    window: TownMicroRouteWindow;
    fromCategory: TownGraphCategory;
    toCategory: TownGraphCategory;
    weightDelta: number;
  }>;
  seasonTags: TownSeasonKey[];
  window: TownMicroRouteWindow;
}): Array<{ from: TownGraphCategory; to: TownGraphCategory; weight: number }> {
  const activeTags = new Set(input.seasonTags);
  const deltaByEdge = new Map<string, number>();
  for (const row of input.seasonWeights) {
    if (!activeTags.has(row.seasonTag) || row.window !== input.window) {
      continue;
    }
    const key = `${row.fromCategory}>${row.toCategory}`;
    deltaByEdge.set(key, (deltaByEdge.get(key) ?? 0) + row.weightDelta);
  }
  return input.edges.map((edge) => {
    const key = `${edge.from}>${edge.to}`;
    const delta = deltaByEdge.get(key) ?? 0;
    return {
      ...edge,
      weight: Math.max(0.01, Number((edge.weight + delta).toFixed(3))),
    };
  });
}

const DEFAULT_TEMPLATE_NOTES: Partial<Record<TownSeasonKey, string>> = {
  holiday: "Holiday shopping windows usually increase quick downtown loops.",
  school: "School pickup periods can increase after-school local stop patterns.",
  football: "Game nights can shift demand toward pre- and post-game quick stops.",
  festival: "Festival weekends can drive all-day downtown browsing patterns.",
};

export async function refreshTownSeasonNotesTemplatesForTown(input: {
  townId: string;
  userId?: string;
}): Promise<{ updated: number }> {
  const rows = await listTownSeasons({
    townId: input.townId,
    userId: input.userId,
  });
  let updated = 0;
  for (const row of rows) {
    const existing = row.notes?.trim() ?? "";
    if (existing !== "") {
      continue;
    }
    const template = DEFAULT_TEMPLATE_NOTES[row.seasonKey];
    if (!template) {
      continue;
    }
    await upsertTownSeason({
      townId: input.townId,
      seasonKey: row.seasonKey,
      startDate: row.startDate ?? null,
      endDate: row.endDate ?? null,
      notes: template,
      userId: input.userId,
    });
    updated += 1;
  }
  return { updated };
}

async function listLocalUsersWithSeasonRows(): Promise<Array<{ townId: string; userId: string; latest: string }>> {
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
    const seasonRows = await readLocalArray(path.join(LOCAL_ROOT, userDir, "town_seasons.json"), townSeasonRowSchema);
    const latestByTown = new Map<string, string>();
    for (const row of seasonRows) {
      const latest = latestByTown.get(row.townRef);
      if (!latest || new Date(row.createdAt).getTime() > new Date(latest).getTime()) {
        latestByTown.set(row.townRef, row.createdAt);
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

export async function listTownSeasonRefreshTargets(limit = 20): Promise<Array<{ townId: string; userId?: string }>> {
  const max = Math.max(1, Math.min(100, limit));
  const targets: Array<{ townId: string; userId?: string }> = [];
  const seen = new Set<string>();
  const pulseTargets = await listActiveTownPulseTargets(max * 3);
  for (const target of pulseTargets) {
    const key = `${target.userId ?? ""}:${target.townId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
    if (targets.length >= max) break;
  }
  if (getStorageMode() !== "supabase" && targets.length < max) {
    const localRows = await listLocalUsersWithSeasonRows();
    for (const row of localRows.sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime())) {
      const key = `${row.userId}:${row.townId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ townId: row.townId, userId: row.userId });
      if (targets.length >= max) break;
    }
  }
  return targets;
}
