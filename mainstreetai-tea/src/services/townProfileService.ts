import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { townProfileSchema, townProfileUpsertSchema, type TownProfile, type TownProfileUpsert } from "../schemas/townProfileSchema";
import { townRecordSchema, type TownRecord } from "../schemas/townSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const PROFILES_FILE = path.join(LOCAL_ROOT, "town_profiles.json");

type SupabaseTownProfileRow = {
  id: string;
  town_ref: string;
  greeting_style: string;
  community_focus: string;
  seasonal_priority: string;
  school_integration_enabled: boolean;
  sponsorship_style: string;
  created_at: string;
  updated_at: string;
};

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

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

async function readLocalProfiles(): Promise<TownProfile[]> {
  const parsed = z.array(townProfileSchema).safeParse(await readJsonOrNull<unknown>(PROFILES_FILE));
  if (parsed.success) {
    return parsed.data;
  }
  return [];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTownProfile(row: SupabaseTownProfileRow): TownProfile {
  return townProfileSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    greetingStyle: row.greeting_style,
    communityFocus: row.community_focus,
    seasonalPriority: row.seasonal_priority,
    schoolIntegrationEnabled: row.school_integration_enabled,
    sponsorshipStyle: row.sponsorship_style,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
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

function defaultProfile(townId: string): TownProfile {
  const now = new Date().toISOString();
  const parsed = townProfileUpsertSchema.parse({});
  return townProfileSchema.parse({
    id: `town-profile-${townId}`,
    townRef: townId,
    greetingStyle: parsed.greetingStyle,
    communityFocus: parsed.communityFocus,
    seasonalPriority: parsed.seasonalPriority,
    schoolIntegrationEnabled: parsed.schoolIntegrationEnabled,
    sponsorshipStyle: parsed.sponsorshipStyle,
    createdAt: now,
    updatedAt: now,
  });
}

export function townHubHeaderLine(input: { townName: string }): string {
  const name = normalizeWhitespace(input.townName);
  if (!name) {
    return "Local Network";
  }
  return `${name} Local Network`;
}

export async function getTownById(input: { townId: string; userId?: string }): Promise<TownRecord | null> {
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
  const filePath = path.join(LOCAL_ROOT, input.userId, "towns.json");
  const parsed = z.array(townRecordSchema).safeParse(await readJsonOrNull<unknown>(filePath));
  if (!parsed.success) {
    return null;
  }
  return parsed.data.find((town) => town.id === input.townId) ?? null;
}

export async function getTownProfileForTown(input: { townId: string }): Promise<TownProfile | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_profiles").select("*").eq("town_ref", input.townId).maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toTownProfile(data as SupabaseTownProfileRow);
  }
  const rows = await readLocalProfiles();
  return rows.find((row) => row.townRef === input.townId) ?? null;
}

export async function resolveTownProfileForTown(input: { townId: string }): Promise<TownProfile> {
  return (await getTownProfileForTown({ townId: input.townId })) ?? defaultProfile(input.townId);
}

export async function upsertTownProfileForTown(input: {
  townId: string;
  updates: Partial<TownProfileUpsert>;
}): Promise<TownProfile> {
  const parsedUpdates = townProfileUpsertSchema.parse(input.updates);
  const cleaned = {
    greetingStyle: normalizeWhitespace(parsedUpdates.greetingStyle).slice(0, 160),
    communityFocus: normalizeWhitespace(parsedUpdates.communityFocus).slice(0, 200),
    seasonalPriority: normalizeWhitespace(parsedUpdates.seasonalPriority).slice(0, 200),
    schoolIntegrationEnabled: parsedUpdates.schoolIntegrationEnabled,
    sponsorshipStyle: normalizeWhitespace(parsedUpdates.sponsorshipStyle).slice(0, 180),
  };
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_profiles")
      .upsert(
        {
          town_ref: input.townId,
          greeting_style: cleaned.greetingStyle,
          community_focus: cleaned.communityFocus,
          seasonal_priority: cleaned.seasonalPriority,
          school_integration_enabled: cleaned.schoolIntegrationEnabled,
          sponsorship_style: cleaned.sponsorshipStyle,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "town_ref" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownProfile(data as SupabaseTownProfileRow);
  }

  await ensureDir(path.dirname(PROFILES_FILE));
  const rows = await readLocalProfiles();
  const now = new Date().toISOString();
  const existingIndex = rows.findIndex((row) => row.townRef === input.townId);
  const existing = existingIndex >= 0 ? rows[existingIndex] : defaultProfile(input.townId);
  const next = townProfileSchema.parse({
    id: existingIndex >= 0 ? existing.id : randomUUID(),
    townRef: input.townId,
    greetingStyle: cleaned.greetingStyle,
    communityFocus: cleaned.communityFocus,
    seasonalPriority: cleaned.seasonalPriority,
    schoolIntegrationEnabled: cleaned.schoolIntegrationEnabled,
    sponsorshipStyle: cleaned.sponsorshipStyle,
    createdAt: existing.createdAt,
    updatedAt: now,
  });
  if (existingIndex >= 0) {
    rows[existingIndex] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(PROFILES_FILE, rows);
  return next;
}
