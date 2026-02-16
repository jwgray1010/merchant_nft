import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import {
  brandLifecycleStatusFor,
  brandProfileSchema,
  type BrandProfile,
} from "../schemas/brandSchema";
import type { DailyGoal } from "../schemas/dailyOneButtonSchema";
import {
  dailyTownBoostSchema,
  townBusinessSummarySchema,
  townMembershipSchema,
  townMembershipUpdateSchema,
  townModePromptOutputSchema,
  townParticipationLevelSchema,
  townRecordSchema,
  townRotationSchema,
  type DailyTownBoost,
  type TownBusinessSummary,
  type TownMembership,
  type TownParticipationLevel,
  type TownRecord,
} from "../schemas/townSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const LOCAL_TOWN_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseBrandRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  business_name: string;
  type: string;
  status: string | null;
  town_ref: string | null;
};

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

type SupabaseTownMembershipRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  town_ref: string;
  participation_level: string;
  created_at: string;
};

type SupabaseTownRotationRow = {
  id: string;
  town_ref: string;
  brand_ref: string;
  last_featured: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(userId: string): string {
  return path.join(LOCAL_TOWN_ROOT, safePathSegment(userId));
}

function localTownsPath(userId: string): string {
  return path.join(localUserDir(userId), "towns.json");
}

function localMembershipsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_memberships.json");
}

function localRotationsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_rotations.json");
}

function localBrandPath(userId: string, brandId: string): string {
  return path.join(localUserDir(userId), "brands", `${brandId}.json`);
}

function lower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
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
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function readLocalArray<T>(filePath: string, itemSchema: z.ZodType<T>): Promise<T[]> {
  const parsed = z.array(itemSchema).safeParse(await readJsonOrNull<unknown>(filePath));
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

function toTownMembership(row: SupabaseTownMembershipRow): TownMembership {
  return townMembershipSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandRef: row.brand_ref,
    townRef: row.town_ref,
    participationLevel: row.participation_level,
    createdAt: row.created_at,
  });
}

function toTownRotation(row: SupabaseTownRotationRow) {
  return townRotationSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    brandRef: row.brand_ref,
    lastFeatured: row.last_featured,
  });
}

function normalizeTownName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function isParticipationEnabled(level: TownParticipationLevel | undefined): boolean {
  return (level ?? "standard") !== "hidden";
}

export function suggestTownFromLocation(location: string): string {
  const trimmed = location.trim();
  if (trimmed === "") {
    return "";
  }
  const firstPart = trimmed.split(",")[0]?.trim();
  return firstPart || trimmed;
}

async function supabaseFindOwnedBrand(userId: string, brandId: string): Promise<SupabaseBrandRow | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id, owner_id, brand_id, business_name, type, status, town_ref")
    .eq("owner_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as SupabaseBrandRow | null) ?? null;
}

async function supabaseFindTownByName(input: { name: string; region?: string }): Promise<TownRecord | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("towns").select("*").ilike("name", input.name).limit(25);
  if (error) {
    throw error;
  }
  const rows = ((data ?? []) as SupabaseTownRow[]).filter(
    (row) =>
      lower(row.name) === lower(input.name) &&
      (input.region ? lower(row.region) === lower(input.region) : true),
  );
  const row = rows[0];
  return row ? toTownRecord(row) : null;
}

async function supabaseCreateTown(input: { name: string; region?: string; timezone?: string }): Promise<TownRecord> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("towns")
    .insert({
      name: input.name,
      region: input.region ?? null,
      timezone: input.timezone ?? "America/Chicago",
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toTownRecord(data as SupabaseTownRow);
}

async function supabaseGetTownById(townId: string): Promise<TownRecord | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("towns").select("*").eq("id", townId).maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return toTownRecord(data as SupabaseTownRow);
}

async function supabaseUpsertMembership(input: {
  ownerId: string;
  brandRef: string;
  townRef: string;
  participationLevel: TownParticipationLevel;
}): Promise<TownMembership> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("town_memberships")
    .upsert(
      {
        owner_id: input.ownerId,
        brand_ref: input.brandRef,
        town_ref: input.townRef,
        participation_level: input.participationLevel,
      },
      { onConflict: "brand_ref" },
    )
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toTownMembership(data as SupabaseTownMembershipRow);
}

async function supabaseGetMembershipByBrandRef(brandRef: string): Promise<TownMembership | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("town_memberships")
    .select("*")
    .eq("brand_ref", brandRef)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? toTownMembership(data as SupabaseTownMembershipRow) : null;
}

async function supabaseSetBrandTownRef(input: { brandRef: string; townRef: string }): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { error } = await table("brands").update({ town_ref: input.townRef }).eq("id", input.brandRef);
  if (error) {
    throw error;
  }
}

async function localGetBrand(userId: string, brandId: string): Promise<BrandProfile | null> {
  const raw = await readJsonOrNull<unknown>(localBrandPath(userId, brandId));
  if (!raw) {
    return null;
  }
  const parsed = brandProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

async function localUpdateBrandTownRef(input: {
  userId: string;
  brand: BrandProfile;
  townRef: string;
}): Promise<void> {
  await ensureDir(path.dirname(localBrandPath(input.userId, input.brand.brandId)));
  await atomicWriteJson(localBrandPath(input.userId, input.brand.brandId), {
    ...input.brand,
    townRef: input.townRef,
  });
}

async function localEnsureTown(input: {
  userId: string;
  name: string;
  region?: string;
  timezone?: string;
}): Promise<TownRecord> {
  const filePath = localTownsPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const towns = await readLocalArray(filePath, townRecordSchema);
  const found = towns.find(
    (town) =>
      lower(town.name) === lower(input.name) &&
      (input.region ? lower(town.region) === lower(input.region) : true),
  );
  if (found) {
    return found;
  }
  const created = townRecordSchema.parse({
    id: randomUUID(),
    name: input.name,
    region: input.region,
    timezone: input.timezone ?? "America/Chicago",
    createdAt: new Date().toISOString(),
  });
  towns.push(created);
  await atomicWriteJson(filePath, towns);
  return created;
}

async function localGetTownById(userId: string, townId: string): Promise<TownRecord | null> {
  const towns = await readLocalArray(localTownsPath(userId), townRecordSchema);
  return towns.find((town) => town.id === townId) ?? null;
}

async function localUpsertMembership(input: {
  userId: string;
  ownerId: string;
  brandRef: string;
  townRef: string;
  participationLevel: TownParticipationLevel;
}): Promise<TownMembership> {
  const filePath = localMembershipsPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const memberships = await readLocalArray(filePath, townMembershipSchema);
  const existingIndex = memberships.findIndex((entry) => entry.brandRef === input.brandRef);
  const nowIso = new Date().toISOString();
  const next = townMembershipSchema.parse({
    id: existingIndex >= 0 ? memberships[existingIndex].id : randomUUID(),
    ownerId: input.ownerId,
    brandRef: input.brandRef,
    townRef: input.townRef,
    participationLevel: input.participationLevel,
    createdAt: existingIndex >= 0 ? memberships[existingIndex].createdAt : nowIso,
  });
  if (existingIndex >= 0) {
    memberships[existingIndex] = next;
  } else {
    memberships.push(next);
  }
  await atomicWriteJson(filePath, memberships);
  return next;
}

async function localGetMembership(userId: string, brandRef: string): Promise<TownMembership | null> {
  const memberships = await readLocalArray(localMembershipsPath(userId), townMembershipSchema);
  return memberships.find((entry) => entry.brandRef === brandRef) ?? null;
}

async function localUpsertRotation(input: {
  userId: string;
  townRef: string;
  brandRef: string;
}): Promise<void> {
  const filePath = localRotationsPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const rotations = await readLocalArray(filePath, townRotationSchema);
  const index = rotations.findIndex((entry) => entry.townRef === input.townRef && entry.brandRef === input.brandRef);
  const updated = townRotationSchema.parse({
    id: index >= 0 ? rotations[index].id : randomUUID(),
    townRef: input.townRef,
    brandRef: input.brandRef,
    lastFeatured: new Date().toISOString(),
  });
  if (index >= 0) {
    rotations[index] = updated;
  } else {
    rotations.push(updated);
  }
  await atomicWriteJson(filePath, rotations);
}

async function localListRotationsForTown(userId: string, townRef: string) {
  const rotations = await readLocalArray(localRotationsPath(userId), townRotationSchema);
  return rotations.filter((entry) => entry.townRef === townRef);
}

export async function ensureTownMembershipForBrand(input: {
  userId: string;
  brandId: string;
  townName: string;
  region?: string;
  timezone?: string;
  participationLevel?: TownParticipationLevel;
}): Promise<{ town: TownRecord; membership: TownMembership }> {
  const townName = normalizeTownName(input.townName);
  if (!townName) {
    throw new Error("Town name is required");
  }
  const participationLevel = townParticipationLevelSchema.parse(input.participationLevel ?? "standard");
  if (getStorageMode() === "supabase") {
    const brandRow = await supabaseFindOwnedBrand(input.userId, input.brandId);
    if (!brandRow) {
      throw new Error(`Brand '${input.brandId}' was not found`);
    }
    const town =
      (await supabaseFindTownByName({ name: townName, region: input.region })) ??
      (await supabaseCreateTown({ name: townName, region: input.region, timezone: input.timezone }));
    if (brandRow.town_ref !== town.id) {
      await supabaseSetBrandTownRef({ brandRef: brandRow.id, townRef: town.id });
    }
    const membership = await supabaseUpsertMembership({
      ownerId: brandRow.owner_id,
      brandRef: brandRow.id,
      townRef: town.id,
      participationLevel,
    });
    return { town, membership };
  }

  const brand = await localGetBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const town = await localEnsureTown({
    userId: input.userId,
    name: townName,
    region: input.region,
    timezone: input.timezone,
  });
  if (brand.townRef !== town.id) {
    await localUpdateBrandTownRef({ userId: input.userId, brand, townRef: town.id });
  }
  const membership = await localUpsertMembership({
    userId: input.userId,
    ownerId: input.userId,
    brandRef: brand.brandId,
    townRef: town.id,
    participationLevel,
  });
  return { town, membership };
}

export async function getTownMembershipForBrand(input: {
  userId: string;
  brandId: string;
}): Promise<{ town: TownRecord; membership: TownMembership } | null> {
  if (getStorageMode() === "supabase") {
    const brandRow = await supabaseFindOwnedBrand(input.userId, input.brandId);
    if (!brandRow?.town_ref) {
      return null;
    }
    const [town, membership] = await Promise.all([
      supabaseGetTownById(brandRow.town_ref),
      supabaseGetMembershipByBrandRef(brandRow.id),
    ]);
    if (!town || !membership) {
      return null;
    }
    return { town, membership };
  }
  const brand = await localGetBrand(input.userId, input.brandId);
  if (!brand?.townRef) {
    return null;
  }
  const [town, membership] = await Promise.all([
    localGetTownById(input.userId, brand.townRef),
    localGetMembership(input.userId, brand.brandId),
  ]);
  if (!town || !membership) {
    return null;
  }
  return { town, membership };
}

export async function updateTownMembershipForBrand(input: {
  userId: string;
  brandId: string;
  settings: z.infer<typeof townMembershipUpdateSchema>;
  fallbackTownName?: string;
}): Promise<{ town: TownRecord; membership: TownMembership; enabled: boolean }> {
  const parsed = townMembershipUpdateSchema.parse(input.settings);
  const desiredLevel: TownParticipationLevel = parsed.enabled
    ? parsed.participationLevel ?? "standard"
    : "hidden";
  const townName = normalizeTownName(parsed.townName ?? input.fallbackTownName ?? "");
  const ensured = await ensureTownMembershipForBrand({
    userId: input.userId,
    brandId: input.brandId,
    townName,
    region: parsed.region,
    timezone: parsed.timezone,
    participationLevel: desiredLevel,
  });
  return {
    town: ensured.town,
    membership: ensured.membership,
    enabled: isParticipationEnabled(ensured.membership.participationLevel),
  };
}

async function listLocalBusinessesInTown(input: {
  userId: string;
  townRef: string;
  excludeBrandRef: string;
}) {
  const [memberships, rotations] = await Promise.all([
    readLocalArray(localMembershipsPath(input.userId), townMembershipSchema),
    localListRotationsForTown(input.userId, input.townRef),
  ]);
  const candidates = memberships
    .filter(
      (entry) =>
        entry.townRef === input.townRef &&
        entry.brandRef !== input.excludeBrandRef &&
        entry.participationLevel !== "hidden",
    )
    .map((entry) => {
      const rotation = rotations.find((item) => item.brandRef === entry.brandRef);
      return {
        brandRef: entry.brandRef,
        participationLevel: entry.participationLevel,
        lastFeatured: rotation?.lastFeatured,
      };
    });
  const withBrand = await Promise.all(
    candidates.map(async (candidate) => {
      const brand = await localGetBrand(input.userId, candidate.brandRef);
      if (!brand) {
        return null;
      }
      if (brandLifecycleStatusFor(brand) !== "active") {
        return null;
      }
      return {
        brandRef: candidate.brandRef,
        name: brand.businessName,
        type: brand.type,
        participationLevel: candidate.participationLevel,
        lastFeatured: candidate.lastFeatured,
      };
    }),
  );
  return withBrand.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

async function listSupabaseBusinessesInTown(input: {
  townRef: string;
  excludeBrandRef: string;
}): Promise<
  Array<{
    brandRef: string;
    name: string;
    type: string;
    participationLevel: TownParticipationLevel;
    lastFeatured?: string;
  }>
> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const membershipsResponse = await table("town_memberships")
    .select("brand_ref, participation_level")
    .eq("town_ref", input.townRef)
    .neq("brand_ref", input.excludeBrandRef)
    .neq("participation_level", "hidden")
    .limit(50);
  if (membershipsResponse.error) {
    throw membershipsResponse.error;
  }
  const memberships = (membershipsResponse.data ?? []) as Array<{
    brand_ref: string;
    participation_level: string;
  }>;
  const brandRefs = memberships
    .map((entry) => entry.brand_ref)
    .filter((entry): entry is string => typeof entry === "string");
  if (brandRefs.length === 0) {
    return [];
  }
  const [brandsResponse, rotationsResponse] = await Promise.all([
    table("brands").select("id, business_name, type, status").in("id", brandRefs).eq("status", "active"),
    table("town_rotations").select("*").eq("town_ref", input.townRef).in("brand_ref", brandRefs),
  ]);
  if (brandsResponse.error) {
    throw brandsResponse.error;
  }
  if (rotationsResponse.error) {
    throw rotationsResponse.error;
  }
  const brands = new Map<string, { name: string; type: string }>();
  for (const row of (brandsResponse.data ?? []) as Array<Record<string, unknown>>) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    brands.set(id, {
      name: typeof row.business_name === "string" ? row.business_name : "Local business",
      type: typeof row.type === "string" ? row.type : "other",
    });
  }
  const rotations = new Map<string, string>();
  for (const row of (rotationsResponse.data ?? []) as SupabaseTownRotationRow[]) {
    const parsed = toTownRotation(row);
    rotations.set(parsed.brandRef, parsed.lastFeatured);
  }
  return memberships
    .map((membership) => {
      const brand = brands.get(membership.brand_ref);
      if (!brand) {
        return null;
      }
      return {
        brandRef: membership.brand_ref,
        name: brand.name,
        type: brand.type,
        participationLevel: townParticipationLevelSchema.parse(membership.participation_level),
        lastFeatured: rotations.get(membership.brand_ref),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function pickRotatingBusinesses<T extends { participationLevel: TownParticipationLevel; lastFeatured?: string }>(
  list: T[],
): T[] {
  const ranked = list
    .map((entry) => ({ ...entry, rand: Math.random() }))
    .sort((a, b) => {
      const priorityA = a.participationLevel === "leader" ? 0 : 1;
      const priorityB = b.participationLevel === "leader" ? 0 : 1;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      const timeA = a.lastFeatured ? new Date(a.lastFeatured).getTime() : 0;
      const timeB = b.lastFeatured ? new Date(b.lastFeatured).getTime() : 0;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return a.rand - b.rand;
    });
  return ranked.slice(0, 5);
}

export async function buildTownBoostForDaily(input: {
  userId: string;
  brandId: string;
  brand: BrandProfile;
  goal: DailyGoal;
}): Promise<{ townBoost: DailyTownBoost; optionalCollabIdea?: string } | null> {
  if (!input.brand.townRef) {
    return null;
  }
  if (getStorageMode() === "supabase") {
    const brandRow = await supabaseFindOwnedBrand(input.userId, input.brandId);
    if (!brandRow?.town_ref) {
      return null;
    }
    const town = await supabaseGetTownById(brandRow.town_ref);
    if (!town) {
      return null;
    }
    const businesses = await listSupabaseBusinessesInTown({
      townRef: brandRow.town_ref,
      excludeBrandRef: brandRow.id,
    });
    const activeBusinessCount = businesses.length + 1;
    const clusterBoost = activeBusinessCount >= 4;
    const rotating = pickRotatingBusinesses(businesses);
    if (rotating.length === 0) {
      return null;
    }
    const otherLocalBusinesses: TownBusinessSummary[] = rotating.map((entry) =>
      townBusinessSummarySchema.parse({
        name: entry.name,
        type: entry.type,
      }),
    );
    const promptOutput = await runPrompt({
      promptFile: "town_mode.md",
      brandProfile: input.brand,
      userId: input.userId,
      input: {
        brand: input.brand,
        town: {
          name: town.name,
          region: town.region,
          timezone: town.timezone,
        },
        otherLocalBusinesses,
        goal: input.goal,
        networkMomentum: {
          activeBusinesses: activeBusinessCount,
          clusterBoost,
        },
      },
      outputSchema: townModePromptOutputSchema,
    });
    const topBusiness = rotating[0];
    if (topBusiness) {
      const supabase = getSupabaseAdminClient();
      const table = (name: string): any => supabase.from(name as never);
      await table("town_rotations").upsert(
        {
          town_ref: brandRow.town_ref,
          brand_ref: topBusiness.brandRef,
          last_featured: new Date().toISOString(),
        },
        { onConflict: "town_ref,brand_ref" },
      );
    }
    return {
      townBoost: dailyTownBoostSchema.parse({
        line: promptOutput.localAngle,
        captionAddOn: promptOutput.captionAddOn,
        staffScript: promptOutput.staffScript,
      }),
      optionalCollabIdea: promptOutput.optionalCollabIdea,
    };
  }

  const town = await localGetTownById(input.userId, input.brand.townRef);
  if (!town) {
    return null;
  }
  const businesses = await listLocalBusinessesInTown({
    userId: input.userId,
    townRef: input.brand.townRef,
    excludeBrandRef: input.brand.brandId,
  });
  const activeBusinessCount = businesses.length + 1;
  const clusterBoost = activeBusinessCount >= 4;
  const rotating = pickRotatingBusinesses(businesses);
  if (rotating.length === 0) {
    return null;
  }
  const otherLocalBusinesses: TownBusinessSummary[] = rotating.map((entry) =>
    townBusinessSummarySchema.parse({
      name: entry.name,
      type: entry.type,
    }),
  );
  const promptOutput = await runPrompt({
    promptFile: "town_mode.md",
    brandProfile: input.brand,
    userId: input.userId,
    input: {
      brand: input.brand,
      town: {
        name: town.name,
        region: town.region,
        timezone: town.timezone,
      },
      otherLocalBusinesses,
      goal: input.goal,
      networkMomentum: {
        activeBusinesses: activeBusinessCount,
        clusterBoost,
      },
    },
    outputSchema: townModePromptOutputSchema,
  });
  if (rotating[0]) {
    await localUpsertRotation({
      userId: input.userId,
      townRef: input.brand.townRef,
      brandRef: rotating[0].brandRef,
    });
  }
  return {
    townBoost: dailyTownBoostSchema.parse({
      line: promptOutput.localAngle,
      captionAddOn: promptOutput.captionAddOn,
      staffScript: promptOutput.staffScript,
    }),
    optionalCollabIdea: promptOutput.optionalCollabIdea,
  };
}

function buildTownMapCategories(businesses: TownBusinessSummary[]): string[] {
  return [...new Set(businesses.map((entry) => entry.type))].sort((a, b) => a.localeCompare(b));
}

async function canActorAccessTownSupabase(actorUserId: string, townId: string): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const [ownerBrand, teamBrand] = await Promise.all([
    table("brands").select("id").eq("owner_id", actorUserId).eq("town_ref", townId).limit(1),
    table("team_members")
      .select("id, brands!inner(id)")
      .eq("user_id", actorUserId)
      .eq("brands.town_ref", townId)
      .limit(1),
  ]);
  if (ownerBrand.error) {
    throw ownerBrand.error;
  }
  if (teamBrand.error) {
    throw teamBrand.error;
  }
  return (ownerBrand.data ?? []).length > 0 || (teamBrand.data ?? []).length > 0;
}

export async function getTownMapForUser(input: {
  actorUserId: string;
  townId: string;
}): Promise<{ town: TownRecord; businesses: TownBusinessSummary[]; categories: string[] } | null> {
  if (getStorageMode() === "supabase") {
    const access = await canActorAccessTownSupabase(input.actorUserId, input.townId);
    if (!access) {
      return null;
    }
    const town = await supabaseGetTownById(input.townId);
    if (!town) {
      return null;
    }
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const membershipsResponse = await table("town_memberships")
      .select("brand_ref")
      .eq("town_ref", input.townId)
      .neq("participation_level", "hidden");
    if (membershipsResponse.error) {
      throw membershipsResponse.error;
    }
    const brandRefs = ((membershipsResponse.data ?? []) as Array<{ brand_ref: string }>)
      .map((entry) => entry.brand_ref)
      .filter((entry): entry is string => typeof entry === "string");
    if (brandRefs.length === 0) {
      return { town, businesses: [], categories: [] };
    }
    const brandsResponse = await table("brands")
      .select("business_name, type, status")
      .in("id", brandRefs)
      .eq("status", "active");
    if (brandsResponse.error) {
      throw brandsResponse.error;
    }
    const businesses = ((brandsResponse.data ?? []) as Array<Record<string, unknown>>)
      .map((row) =>
        townBusinessSummarySchema.safeParse({
          name: typeof row.business_name === "string" ? row.business_name : "",
          type: typeof row.type === "string" ? row.type : "other",
        }),
      )
      .filter((entry): entry is { success: true; data: TownBusinessSummary } => entry.success)
      .map((entry) => entry.data);
    return {
      town,
      businesses,
      categories: buildTownMapCategories(businesses),
    };
  }

  const town = await localGetTownById(input.actorUserId, input.townId);
  if (!town) {
    return null;
  }
  const memberships = await readLocalArray(localMembershipsPath(input.actorUserId), townMembershipSchema);
  const brandRefs = memberships
    .filter((entry) => entry.townRef === input.townId && entry.participationLevel !== "hidden")
    .map((entry) => entry.brandRef);
  const businesses = (
    await Promise.all(
      brandRefs.map(async (brandRef) => {
        const brand = await localGetBrand(input.actorUserId, brandRef);
        if (!brand) {
          return null;
        }
        if (brandLifecycleStatusFor(brand) !== "active") {
          return null;
        }
        return townBusinessSummarySchema.safeParse({
          name: brand.businessName,
          type: brand.type,
        });
      }),
    )
  )
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .filter((entry): entry is { success: true; data: TownBusinessSummary } => entry.success)
    .map((entry) => entry.data);
  return {
    town,
    businesses,
    categories: buildTownMapCategories(businesses),
  };
}

export async function listTownsForActor(actorUserId: string): Promise<TownRecord[]> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const [ownedBrands, teamBrands] = await Promise.all([
      table("brands")
        .select("town_ref")
        .eq("owner_id", actorUserId)
        .not("town_ref", "is", null),
      table("team_members")
        .select("brands!inner(town_ref)")
        .eq("user_id", actorUserId)
        .not("brands.town_ref", "is", null),
    ]);
    if (ownedBrands.error) {
      throw ownedBrands.error;
    }
    if (teamBrands.error) {
      throw teamBrands.error;
    }
    const townIds = new Set<string>();
    for (const row of (ownedBrands.data ?? []) as Array<{ town_ref?: string | null }>) {
      if (typeof row.town_ref === "string" && row.town_ref) {
        townIds.add(row.town_ref);
      }
    }
    for (const row of (teamBrands.data ?? []) as Array<{ brands?: { town_ref?: string | null } }>) {
      const townRef = row.brands?.town_ref;
      if (typeof townRef === "string" && townRef) {
        townIds.add(townRef);
      }
    }
    if (townIds.size === 0) {
      return [];
    }
    const { data, error } = await table("towns").select("*").in("id", [...townIds]).order("name", {
      ascending: true,
    });
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownRow[]).map(toTownRecord);
  }
  const towns = await readLocalArray(localTownsPath(actorUserId), townRecordSchema);
  return towns.sort((a, b) => a.name.localeCompare(b.name));
}
