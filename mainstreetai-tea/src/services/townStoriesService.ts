import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import { type BrandProfile } from "../schemas/brandSchema";
import {
  townStoryContentSchema,
  townStoryRecordSchema,
  townStoryUsageSchema,
  townStoryTypeSchema,
  type TownStoryContent,
  type TownStoryRecord,
  type TownStoryType,
} from "../schemas/townStorySchema";
import { townRecordSchema, type TownRecord } from "../schemas/townSchema";
import { townPulseModelDataSchema } from "../schemas/townPulseSchema";
import { getStorageMode, getAdapter } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { getTownPulseModel, listActiveTownPulseTargets, recomputeTownPulseModel } from "./townPulseService";
import { countActiveBusinessesForTown } from "./communityImpactService";
import { getTownMilestoneSummary, isTownFeatureUnlocked, summarizeTownSuccessSignals } from "./townAdoptionService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

type SupabaseTownStoryRow = {
  id: string;
  town_ref: string;
  story_type: string;
  content: unknown;
  generated_at: string;
};

type SupabaseBrandRow = {
  id: string;
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

function localStoriesPath(userId: string): string {
  return path.join(localUserDir(userId), "town_stories.json");
}

function localStoryUsagePath(userId: string): string {
  return path.join(localUserDir(userId), "town_story_usage.json");
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

function toTownStoryRecord(row: SupabaseTownStoryRow): TownStoryRecord {
  return townStoryRecordSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    storyType: row.story_type,
    content: row.content,
    generatedAt: row.generated_at,
  });
}

function seasonFromDate(now = new Date()): "winter" | "spring" | "summer" | "fall" {
  const month = now.getUTCMonth() + 1;
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

function deriveEnergyLevel(townPulse: z.infer<typeof townPulseModelDataSchema> | null): "low" | "medium" | "high" {
  if (!townPulse) {
    return "medium";
  }
  const busy = townPulse.busyWindows.length;
  const slow = townPulse.slowWindows.length;
  const eventBoost = townPulse.eventEnergy === "high" ? 2.5 : townPulse.eventEnergy === "medium" ? 1 : 0;
  const score = busy * 1.2 + eventBoost - slow * 0.4;
  if (score >= 5.5) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function fallbackTownPulseModel() {
  return townPulseModelDataSchema.parse({
    busyWindows: [],
    slowWindows: [],
    eventEnergy: "low",
    seasonalNotes: "Local rhythm is still warming up.",
    categoryTrends: [],
  });
}

function syntheticBrandProfileForTown(town: TownRecord): BrandProfile {
  return {
    brandId: `town-story-${town.id.slice(0, 8).toLowerCase()}`,
    businessName: `${town.name} Local Story`,
    location: town.region ? `${town.name}, ${town.region}` : town.name,
    townRef: town.id,
    supportLevel: "steady",
    type: "other",
    voice: "Warm, community-first, and neighborly.",
    audiences: ["locals", "neighbors", "families"],
    productsOrServices: ["local storytelling"],
    hours: "Community hours vary",
    typicalRushTimes: "Midweek and weekends",
    slowHours: "Varies by season",
    offersWeCanUse: [],
    constraints: {
      noHugeDiscounts: true,
      keepPromosSimple: true,
      avoidCorporateLanguage: true,
      avoidControversy: true,
    },
    communityVibeProfile: {
      localTone: "neighborly",
      collaborationLevel: "medium",
      localIdentityTags: ["small-town", "support-local"],
      audienceStyle: "mixed",
      avoidCorporateTone: true,
    },
  };
}

function sanitizeTownStory(content: TownStoryContent): TownStoryContent {
  const stripAnalytics = (value: string) => {
    const cleaned = value
      .replace(/\b(analytics?|metrics?|data sources?|according to our data)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return cleaned || value.trim();
  };
  return townStoryContentSchema.parse({
    headline: stripAnalytics(content.headline),
    summary: stripAnalytics(content.summary),
    socialCaption: stripAnalytics(content.socialCaption),
    conversationStarter: stripAnalytics(content.conversationStarter),
    signLine: stripAnalytics(content.signLine),
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
  const towns = await readLocalArray(localTownsPath(input.userId), townRecordSchema);
  return towns.find((town) => town.id === input.townId) ?? null;
}

async function saveTownStory(input: {
  storyType: TownStoryType;
  townId: string;
  content: TownStoryContent;
  generatedAt?: string;
  userId?: string;
}): Promise<TownStoryRecord> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_stories")
      .insert({
        town_ref: input.townId,
        story_type: input.storyType,
        content: input.content,
        generated_at: generatedAt,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownStoryRecord(data as SupabaseTownStoryRow);
  }
  if (!input.userId) {
    throw new Error("userId is required for local town story persistence");
  }
  const filePath = localStoriesPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray(filePath, townStoryRecordSchema);
  const record = townStoryRecordSchema.parse({
    id: randomUUID(),
    townRef: input.townId,
    storyType: input.storyType,
    content: input.content,
    generatedAt,
  });
  existing.push(record);
  await atomicWriteJson(filePath, existing.slice(-1200));
  return record;
}

async function upsertTownStoryUsageLocal(input: {
  userId: string;
  townStoryRef: string;
  brandRef: string;
}): Promise<void> {
  const filePath = localStoryUsagePath(input.userId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray(filePath, townStoryUsageSchema);
  const duplicate = existing.some(
    (entry) => entry.townStoryRef === input.townStoryRef && entry.brandRef === input.brandRef,
  );
  if (duplicate) {
    return;
  }
  existing.push(
    townStoryUsageSchema.parse({
      id: randomUUID(),
      townStoryRef: input.townStoryRef,
      brandRef: input.brandRef,
      usedAt: new Date().toISOString(),
    }),
  );
  await atomicWriteJson(filePath, existing.slice(-4000));
}

async function resolveSupabaseBrandRef(input: { userId: string; brandId: string }): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id")
    .eq("owner_id", input.userId)
    .eq("brand_id", input.brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const row = (data as SupabaseBrandRow | null) ?? null;
  return row?.id ?? null;
}

export async function recordTownStoryUsageForBrand(input: {
  userId: string;
  brandId: string;
  townStoryRef: string;
}): Promise<void> {
  if (getStorageMode() === "supabase") {
    const brandRef = await resolveSupabaseBrandRef({
      userId: input.userId,
      brandId: input.brandId,
    });
    if (!brandRef) {
      return;
    }
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { error } = await table("town_story_usage").insert({
      town_story_ref: input.townStoryRef,
      brand_ref: brandRef,
    });
    if (error && error.code !== "23505") {
      throw error;
    }
    return;
  }
  await upsertTownStoryUsageLocal({
    userId: input.userId,
    townStoryRef: input.townStoryRef,
    brandRef: input.brandId,
  });
}

export async function getLatestTownStory(input: {
  townId: string;
  userId?: string;
}): Promise<TownStoryRecord | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_stories")
      .select("*")
      .eq("town_ref", input.townId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toTownStoryRecord(data as SupabaseTownStoryRow) : null;
  }
  if (!input.userId) {
    return null;
  }
  const rows = await readLocalArray(localStoriesPath(input.userId), townStoryRecordSchema);
  return rows
    .filter((entry) => entry.townRef === input.townId)
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0] ?? null;
}

export async function getLatestTownStoryForBrand(input: {
  userId: string;
  brandId: string;
}): Promise<TownStoryRecord | null> {
  const brand = await getAdapter().getBrand(input.userId, input.brandId);
  if (!brand?.townRef) {
    return null;
  }
  return getLatestTownStory({
    townId: brand.townRef,
    userId: input.userId,
  });
}

function cadenceMinutes(cadence: "daily" | "weekly"): number {
  return cadence === "weekly" ? 7 * 24 * 60 : 22 * 60;
}

async function isTownDueForStory(input: {
  townId: string;
  cadence: "daily" | "weekly";
  userId?: string;
}): Promise<boolean> {
  const latest = await getLatestTownStory({
    townId: input.townId,
    userId: input.userId,
  });
  if (!latest) {
    return true;
  }
  const latestMs = new Date(latest.generatedAt).getTime();
  if (!Number.isFinite(latestMs)) {
    return true;
  }
  const ageMinutes = (Date.now() - latestMs) / (60 * 1000);
  return ageMinutes >= cadenceMinutes(input.cadence);
}

async function listAdditionalSupabaseActiveTowns(limit: number): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("town_memberships")
    .select("town_ref, created_at")
    .neq("participation_level", "hidden")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 3, 30));
  if (error) {
    throw error;
  }
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<{ town_ref?: string | null }>) {
    const townId = typeof row.town_ref === "string" ? row.town_ref : "";
    if (!townId || seen.has(townId)) continue;
    seen.add(townId);
    deduped.push(townId);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

export async function listDueTownStoryTargets(input: {
  limit?: number;
  cadence: "daily" | "weekly";
}): Promise<Array<{ townId: string; userId?: string }>> {
  const max = Math.max(1, Math.min(100, input.limit ?? 20));
  const pulseTargets = await listActiveTownPulseTargets(max * 3);
  const candidates: Array<{ townId: string; userId?: string }> = [];
  const seen = new Set<string>();
  for (const target of pulseTargets) {
    if (seen.has(target.townId)) continue;
    seen.add(target.townId);
    candidates.push(target);
  }
  if (getStorageMode() === "supabase" && candidates.length < max) {
    const additional = await listAdditionalSupabaseActiveTowns(max);
    for (const townId of additional) {
      if (seen.has(townId)) continue;
      seen.add(townId);
      candidates.push({ townId });
    }
  }

  const due: Array<{ townId: string; userId?: string }> = [];
  for (const target of candidates) {
    const milestone = await getTownMilestoneSummary({
      townId: target.townId,
      userId: target.userId,
    }).catch(() => null);
    if (!milestone || !isTownFeatureUnlocked({ milestone, feature: "town_stories" })) {
      continue;
    }
    const shouldRun = await isTownDueForStory({
      townId: target.townId,
      userId: target.userId,
      cadence: input.cadence,
    });
    if (!shouldRun) {
      continue;
    }
    due.push(target);
    if (due.length >= max) {
      break;
    }
  }
  return due;
}

export async function generateTownStoryForTown(input: {
  townId: string;
  userId?: string;
  storyType?: TownStoryType;
}): Promise<{ town: TownRecord; story: TownStoryRecord }> {
  const storyType = townStoryTypeSchema.parse(input.storyType ?? "daily");
  const town = await getTownById({
    townId: input.townId,
    userId: input.userId,
  });
  if (!town) {
    throw new Error(`Town '${input.townId}' was not found`);
  }

  let pulse = await getTownPulseModel({
    townId: input.townId,
    userId: input.userId,
  });
  if (!pulse) {
    pulse = await recomputeTownPulseModel({
      townId: input.townId,
      rangeDays: 45,
      userId: input.userId,
    }).catch(() => null);
  }
  const townPulse = pulse?.model ?? fallbackTownPulseModel();
  const season = seasonFromDate();
  const energyLevel = deriveEnergyLevel(townPulse);
  const activeBusinesses = await countActiveBusinessesForTown({
    townId: input.townId,
    userId: input.userId,
  }).catch(() => 0);
  const milestone = await getTownMilestoneSummary({
    townId: input.townId,
    userId: input.userId,
  });
  if (!isTownFeatureUnlocked({ milestone, feature: "town_stories" })) {
    throw new Error("Town Stories unlock after 3 active businesses join a town.");
  }
  const successSignals = await summarizeTownSuccessSignals({
    townId: input.townId,
    userId: input.userId,
    sinceDays: 45,
  }).catch(() => ({
    confidence: "low" as const,
    totalWeight: 0,
    bySignal: [],
  }));
  const promptOutput = await runPrompt({
    promptFile: "town_stories.md",
    brandProfile: syntheticBrandProfileForTown(town),
    userId: input.userId,
    input: {
      town: {
        id: town.id,
        name: town.name,
        region: town.region ?? null,
        timezone: town.timezone,
      },
      townPulse,
      season,
      energyLevel,
      activeBusinesses,
      shopLocalMomentum: activeBusinesses >= 4 ? "building" : "warming",
      momentumNarrative: milestone.momentumLine ?? "",
      successSignals: {
        confidence: successSignals.confidence,
        totalWeight: successSignals.totalWeight,
        topSignals: successSignals.bySignal.slice(0, 3).map((entry) => ({
          signal: entry.signal,
          weight: entry.weight,
        })),
      },
      storyType,
    },
    outputSchema: townStoryContentSchema,
  });
  const story = await saveTownStory({
    townId: town.id,
    storyType,
    userId: input.userId,
    content: sanitizeTownStory(promptOutput),
  });
  return { town, story };
}
