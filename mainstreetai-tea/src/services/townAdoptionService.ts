import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  brandLifecycleStatusFor,
  type BrandLifecycleStatus,
  type BrandProfile,
} from "../schemas/brandSchema";
import { communitySponsorRoleSchema } from "../schemas/communityImpactSchema";
import {
  townAmbassadorRoleSchema,
  townAmbassadorRowSchema,
  townFeatureUnlockSchema,
  townInviteRowSchema,
  townMilestoneSummarySchema,
  townSuccessSignalRowSchema,
  type TownAmbassadorRole,
  type TownFeatureUnlock,
  type TownMilestoneSummary,
  type TownSuccessSignal,
} from "../schemas/townAdoptionSchema";
import { townMembershipSchema } from "../schemas/townSchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { countActiveBusinessesForTown } from "./communityImpactService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseBrandRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  business_name: string;
  status: string | null;
  town_ref: string | null;
};

type SupabaseTownMembershipRow = {
  brand_ref: string;
  participation_level: string;
};

type SupabaseTownAmbassadorRow = {
  id: string;
  town_ref: string;
  brand_ref: string;
  role: string | null;
  joined_at: string;
  brands?: { business_name?: unknown; brand_id?: unknown; status?: unknown } | null;
};

type SupabaseTownInviteRow = {
  id: string;
  town_ref: string;
  invited_business: string;
  invited_by_brand_ref: string;
  category: string | null;
  invite_code: string | null;
  contact_preference: string | null;
  invited_phone: string | null;
  invited_email: string | null;
  status: string;
  created_at: string;
};

type SupabaseTownSuccessSignalRow = {
  id: string;
  town_ref: string;
  signal: string;
  weight: number;
  created_at: string;
};

type SupabaseCommunitySponsorRow = {
  id: string;
  town_ref: string;
  sponsor_name: string;
  role: string | null;
  sponsored_seats: number;
  active: boolean;
  created_at: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function localUserDir(userId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(userId));
}

function localBrandPath(userId: string, brandId: string): string {
  return path.join(localUserDir(userId), "brands", `${brandId}.json`);
}

function localTownMembershipsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_memberships.json");
}

function localTownAmbassadorsPath(): string {
  return path.join(LOCAL_ROOT, "town_ambassadors.json");
}

function localTownInvitesPath(): string {
  return path.join(LOCAL_ROOT, "town_invites.json");
}

function localTownSuccessSignalsPath(): string {
  return path.join(LOCAL_ROOT, "town_success_signals.json");
}

function localCommunitySponsorsPath(): string {
  return path.join(LOCAL_ROOT, "community_sponsors.json");
}

function localBrandRef(ownerId: string, brandId: string): string {
  return `${ownerId}:${brandId}`;
}

function parseLocalBrandRef(value: string): { ownerId: string; brandId: string } | null {
  const splitAt = value.indexOf(":");
  if (splitAt <= 0) {
    return null;
  }
  const ownerId = value.slice(0, splitAt).trim();
  const brandId = value.slice(splitAt + 1).trim();
  if (!ownerId || !brandId) {
    return null;
  }
  return { ownerId, brandId };
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
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
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

async function listLocalUsers(): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(LOCAL_ROOT, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function safeAmbassadorRole(value: unknown): TownAmbassadorRole {
  const parsed = townAmbassadorRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : "ambassador";
}

function safeInviteStatus(value: unknown): z.infer<typeof townInviteRowSchema.shape.status> {
  const parsed = townInviteRowSchema.shape.status.safeParse(value);
  return parsed.success ? parsed.data : "pending";
}

function safeInviteCode(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized.length >= 4) {
      return normalized;
    }
  }
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

function safeSuccessSignal(value: unknown): TownSuccessSignal {
  const parsed = townSuccessSignalRowSchema.shape.signal.safeParse(value);
  return parsed.success ? parsed.data : "repeat_customers_up";
}

function safeSponsorRole(value: unknown): z.infer<typeof communitySponsorRoleSchema> {
  const parsed = communitySponsorRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : "nonprofit";
}

function safeLifecycleStatus(value: unknown): BrandLifecycleStatus {
  return brandLifecycleStatusFor({ status: typeof value === "string" ? value : undefined });
}

function isTownVisibleStatus(value: unknown): boolean {
  return safeLifecycleStatus(value) === "active";
}

function toTownAmbassadorRow(row: SupabaseTownAmbassadorRow) {
  return townAmbassadorRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    brandRef: row.brand_ref,
    role: safeAmbassadorRole(row.role),
    joinedAt: row.joined_at,
  });
}

function toTownInviteRow(row: SupabaseTownInviteRow) {
  return townInviteRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    invitedBusiness: row.invited_business,
    invitedByBrandRef: row.invited_by_brand_ref,
    category: row.category ?? "other",
    inviteCode: safeInviteCode(row.invite_code ?? row.id.slice(0, 12)),
    contactPreference: row.contact_preference === "sms" || row.contact_preference === "email"
      ? row.contact_preference
      : undefined,
    invitedPhone: row.invited_phone ?? undefined,
    invitedEmail: row.invited_email ?? undefined,
    status: safeInviteStatus(row.status),
    createdAt: row.created_at,
  });
}

function toTownSuccessSignalRow(row: SupabaseTownSuccessSignalRow) {
  return townSuccessSignalRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    signal: safeSuccessSignal(row.signal),
    weight: Number(row.weight ?? 1),
    createdAt: row.created_at,
  });
}

function featureUnlocksFromCount(activeCount: number): TownFeatureUnlock[] {
  const features: TownFeatureUnlock[] = [];
  if (activeCount >= 3) {
    features.push("town_stories");
  }
  if (activeCount >= 5) {
    features.push("town_pulse_learning");
  }
  if (activeCount >= 10) {
    features.push("town_graph_routes");
  }
  return features;
}

function launchFlowMessageFromCount(activeCount: number): string | undefined {
  if (activeCount <= 1) {
    return "You're starting something new here.";
  }
  if (activeCount === 2) {
    return "You're not alone anymore.";
  }
  if (activeCount >= 5) {
    return "Your town now has a shared rhythm.";
  }
  return undefined;
}

function momentumLineFromCount(activeCount: number): string | undefined {
  if (activeCount >= 2) {
    return "Your town is building momentum.";
  }
  return undefined;
}

async function resolveBrandTownContext(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ brandRef: string; townRef: string | null; businessName: string; status: BrandLifecycleStatus }> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("brands")
      .select("id, owner_id, brand_id, business_name, town_ref, status")
      .eq("owner_id", input.ownerId)
      .eq("brand_id", input.brandId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data as SupabaseBrandRow | null) ?? null;
    if (!row) {
      throw new Error(`Brand '${input.brandId}' was not found`);
    }
    return {
      brandRef: row.id,
      townRef: row.town_ref,
      businessName: row.business_name,
      status: safeLifecycleStatus(row.status),
    };
  }
  const brand = await getAdapter().getBrand(input.ownerId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  return {
    brandRef: localBrandRef(input.ownerId, input.brandId),
    townRef: brand.townRef ?? null,
    businessName: brand.businessName,
    status: safeLifecycleStatus(brand.status),
  };
}

async function getBrandParticipationLevel(input: {
  ownerId: string;
  brandId: string;
  brandRef: string;
  townRef: string;
}): Promise<"standard" | "leader" | "hidden"> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_memberships")
      .select("brand_ref, participation_level")
      .eq("brand_ref", input.brandRef)
      .eq("town_ref", input.townRef)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data as SupabaseTownMembershipRow | null) ?? null;
    const raw = typeof row?.participation_level === "string" ? row.participation_level : "standard";
    return raw === "leader" || raw === "hidden" ? raw : "standard";
  }
  const memberships = await readLocalArray(localTownMembershipsPath(input.ownerId), townMembershipSchema);
  const row = memberships.find((entry) => entry.brandRef === input.brandId && entry.townRef === input.townRef);
  if (!row) {
    return "standard";
  }
  return row.participationLevel;
}

export async function getTownMilestoneSummary(input: {
  townId: string;
  userId?: string;
}): Promise<TownMilestoneSummary> {
  const activeCount = await countActiveBusinessesForTown({
    townId: input.townId,
    userId: input.userId,
  }).catch(() => 0);
  return townMilestoneSummarySchema.parse({
    activeCount,
    featuresUnlocked: featureUnlocksFromCount(activeCount),
    launchMessage: launchFlowMessageFromCount(activeCount),
    momentumLine: momentumLineFromCount(activeCount),
  });
}

export function isTownFeatureUnlocked(input: {
  milestone: TownMilestoneSummary;
  feature: TownFeatureUnlock;
}): boolean {
  return input.milestone.featuresUnlocked.includes(input.feature);
}

export async function getTownAmbassadorForBrand(input: {
  ownerId: string;
  brandId: string;
}): Promise<{
  ambassador: z.infer<typeof townAmbassadorRowSchema>;
  businessName: string;
} | null> {
  const context = await resolveBrandTownContext(input).catch(() => null);
  if (!context) {
    return null;
  }
  if (!isTownVisibleStatus(context.status)) {
    return null;
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_ambassadors")
      .select("*, brands!inner(business_name, brand_id)")
      .eq("brand_ref", context.brandRef)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    const row = data as SupabaseTownAmbassadorRow;
    return {
      ambassador: toTownAmbassadorRow(row),
      businessName:
        typeof row.brands?.business_name === "string" ? row.brands.business_name : context.businessName,
    };
  }
  const rows = await readLocalArray(localTownAmbassadorsPath(), townAmbassadorRowSchema);
  const match = rows.find((row) => row.brandRef === context.brandRef);
  if (!match) {
    return null;
  }
  return {
    ambassador: match,
    businessName: context.businessName,
  };
}

export async function ensureTownAmbassadorForBrand(input: {
  ownerId: string;
  brandId: string;
  role?: TownAmbassadorRole;
}): Promise<z.infer<typeof townAmbassadorRowSchema> | null> {
  const context = await resolveBrandTownContext(input).catch(() => null);
  if (!context?.townRef || !isTownVisibleStatus(context.status)) {
    return null;
  }
  const role = townAmbassadorRoleSchema.parse(input.role ?? "ambassador");
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_ambassadors")
      .upsert(
        {
          town_ref: context.townRef,
          brand_ref: context.brandRef,
          role,
        },
        { onConflict: "brand_ref" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownAmbassadorRow(data as SupabaseTownAmbassadorRow);
  }
  const filePath = localTownAmbassadorsPath();
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townAmbassadorRowSchema);
  const index = rows.findIndex((entry) => entry.brandRef === context.brandRef);
  const next = townAmbassadorRowSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    townRef: context.townRef,
    brandRef: context.brandRef,
    role,
    joinedAt: index >= 0 ? rows[index].joinedAt : new Date().toISOString(),
  });
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(filePath, rows.slice(-3000));
  return next;
}

export async function autoAssignTownAmbassadorForBrand(input: {
  ownerId: string;
  brandId: string;
}): Promise<z.infer<typeof townAmbassadorRowSchema> | null> {
  const context = await resolveBrandTownContext(input).catch(() => null);
  if (!context?.townRef || !isTownVisibleStatus(context.status)) {
    return null;
  }
  const [milestone, participation] = await Promise.all([
    getTownMilestoneSummary({
      townId: context.townRef,
      userId: input.ownerId,
    }),
    getBrandParticipationLevel({
      ownerId: input.ownerId,
      brandId: input.brandId,
      brandRef: context.brandRef,
      townRef: context.townRef,
    }).catch(() => "standard" as const),
  ]);

  const qualifiesAsEarlyAdopter = milestone.activeCount <= 3;
  const qualifiesAsLeader = participation === "leader";
  if (!qualifiesAsEarlyAdopter && !qualifiesAsLeader) {
    return null;
  }
  const role: TownAmbassadorRole = qualifiesAsLeader ? "local_leader" : "ambassador";
  return ensureTownAmbassadorForBrand({
    ownerId: input.ownerId,
    brandId: input.brandId,
    role,
  });
}

export async function listTownAmbassadors(input: {
  townId: string;
  userId?: string;
}): Promise<
  Array<{
    id: string;
    brandRef: string;
    businessName: string;
    role: TownAmbassadorRole;
    joinedAt: string;
  }>
> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_ambassadors")
      .select("*, brands!inner(business_name, brand_id, status)")
      .eq("town_ref", input.townId)
      .eq("brands.status", "active")
      .order("joined_at", { ascending: true });
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownAmbassadorRow[]).map((row) => {
      const parsed = toTownAmbassadorRow(row);
      return {
        id: parsed.id,
        brandRef: parsed.brandRef,
        businessName: typeof row.brands?.business_name === "string" ? row.brands.business_name : "Local business",
        role: parsed.role,
        joinedAt: parsed.joinedAt,
      };
    });
  }
  const rows = await readLocalArray(localTownAmbassadorsPath(), townAmbassadorRowSchema);
  const filtered = rows.filter((row) => row.townRef === input.townId);
  const resolved = await Promise.all(
    filtered.map(async (row) => {
      const parsedRef = parseLocalBrandRef(row.brandRef);
      if (!parsedRef) {
        return {
          id: row.id,
          brandRef: row.brandRef,
          businessName: "Local business",
          role: row.role,
          joinedAt: row.joinedAt,
        };
      }
      const raw = await readJsonOrNull<unknown>(localBrandPath(parsedRef.ownerId, parsedRef.brandId));
      const parsedBrand = z
        .object({ businessName: z.string().min(1), status: z.string().optional() })
        .safeParse(raw);
      if (parsedBrand.success && !isTownVisibleStatus(parsedBrand.data.status)) {
        return null;
      }
      return {
        id: row.id,
        brandRef: row.brandRef,
        businessName: parsedBrand.success ? parsedBrand.data.businessName : parsedRef.brandId,
        role: row.role,
        joinedAt: row.joinedAt,
      };
    }),
  );
  return resolved
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

export async function resolveOwnedInviterBrandForTown(input: {
  ownerId: string;
  townId: string;
  preferredBrandId?: string;
}): Promise<{ ownerId: string; brandId: string; brandRef: string; businessName: string } | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    if (input.preferredBrandId) {
      const { data, error } = await table("brands")
        .select("id, owner_id, brand_id, business_name, town_ref, status")
        .eq("owner_id", input.ownerId)
        .eq("brand_id", input.preferredBrandId)
        .eq("town_ref", input.townId)
        .eq("status", "active")
        .maybeSingle();
      if (error) {
        throw error;
      }
      const row = (data as SupabaseBrandRow | null) ?? null;
      if (row) {
        return {
          ownerId: row.owner_id,
          brandId: row.brand_id,
          brandRef: row.id,
          businessName: row.business_name,
        };
      }
    }
    const { data, error } = await table("brands")
      .select("id, owner_id, brand_id, business_name, town_ref, status, created_at")
      .eq("owner_id", input.ownerId)
      .eq("town_ref", input.townId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data as SupabaseBrandRow | null) ?? null;
    if (!row) {
      return null;
    }
    return {
      ownerId: row.owner_id,
      brandId: row.brand_id,
      brandRef: row.id,
      businessName: row.business_name,
    };
  }

  if (input.preferredBrandId) {
    const brand = await getAdapter().getBrand(input.ownerId, input.preferredBrandId);
    if (brand?.townRef === input.townId && isTownVisibleStatus(brand.status)) {
      return {
        ownerId: input.ownerId,
        brandId: brand.brandId,
        brandRef: localBrandRef(input.ownerId, brand.brandId),
        businessName: brand.businessName,
      };
    }
  }
  const memberships = await readLocalArray(localTownMembershipsPath(input.ownerId), townMembershipSchema);
  const firstBrandId =
    memberships
      .filter((entry) => entry.townRef === input.townId && entry.participationLevel !== "hidden")
      .map((entry) => entry.brandRef)[0] ?? null;
  if (!firstBrandId) {
    return null;
  }
  const brand = await getAdapter().getBrand(input.ownerId, firstBrandId);
  if (!brand || !isTownVisibleStatus(brand.status)) {
    return null;
  }
  return {
    ownerId: input.ownerId,
    brandId: brand.brandId,
    brandRef: localBrandRef(input.ownerId, brand.brandId),
    businessName: brand.businessName,
  };
}

async function hasClosedBusinessNameConflict(input: {
  townId: string;
  invitedBusiness: string;
}): Promise<boolean> {
  const targetName = input.invitedBusiness.trim().toLowerCase();
  const targetSlug = slugify(input.invitedBusiness);
  if (!targetName || !targetSlug) {
    return false;
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("brands")
      .select("brand_id, business_name, status")
      .eq("town_ref", input.townId)
      .eq("status", "closed")
      .limit(400);
    if (error) {
      throw error;
    }
    const rows = (data ?? []) as Array<{ brand_id?: unknown; business_name?: unknown }>;
    return rows.some((row) => {
      const brandSlug = typeof row.brand_id === "string" ? row.brand_id.trim().toLowerCase() : "";
      const businessName = typeof row.business_name === "string" ? row.business_name.trim().toLowerCase() : "";
      return (
        brandSlug === targetSlug ||
        businessName === targetName ||
        (businessName !== "" && slugify(businessName) === targetSlug)
      );
    });
  }

  const users = await listLocalUsers();
  for (const ownerId of users) {
    const memberships = await readLocalArray(localTownMembershipsPath(ownerId), townMembershipSchema);
    const brandIds = memberships
      .filter((entry) => entry.townRef === input.townId)
      .map((entry) => entry.brandRef);
    for (const brandId of brandIds) {
      const brand = await getAdapter().getBrand(ownerId, brandId);
      if (!brand || safeLifecycleStatus(brand.status) !== "closed") {
        continue;
      }
      const brandSlug = brand.brandId.trim().toLowerCase();
      const businessName = brand.businessName.trim().toLowerCase();
      if (
        brandSlug === targetSlug ||
        businessName === targetName ||
        (businessName !== "" && slugify(businessName) === targetSlug)
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function createTownInvite(input: {
  townId: string;
  invitedBusiness: string;
  category: string;
  invitedByBrandRef: string;
  inviteCode?: string;
  contactPreference?: "sms" | "email";
  invitedPhone?: string;
  invitedEmail?: string;
  allowClosedNameReuse?: boolean;
  status?: "pending" | "sent" | "accepted" | "declined";
}): Promise<z.infer<typeof townInviteRowSchema>> {
  const invitedBusiness = input.invitedBusiness.trim();
  const category = input.category.trim() || "other";
  const inviteCode = safeInviteCode(input.inviteCode);
  const contactPreference = input.contactPreference === "sms" || input.contactPreference === "email"
    ? input.contactPreference
    : undefined;
  const invitedPhone = input.invitedPhone?.trim() || undefined;
  const status = safeInviteStatus(input.status ?? "pending");
  const invitedEmail = input.invitedEmail?.trim() || undefined;
  if (!input.allowClosedNameReuse) {
    const closedConflict = await hasClosedBusinessNameConflict({
      townId: input.townId,
      invitedBusiness,
    });
    if (closedConflict) {
      throw new Error("Closed business name reuse requires town admin confirmation.");
    }
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_invites")
      .insert({
        town_ref: input.townId,
        invited_business: invitedBusiness,
        invited_by_brand_ref: input.invitedByBrandRef,
        category,
        invite_code: inviteCode,
        contact_preference: contactPreference ?? null,
        invited_phone: invitedPhone ?? null,
        invited_email: invitedEmail ?? null,
        status,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownInviteRow(data as SupabaseTownInviteRow);
  }
  const filePath = localTownInvitesPath();
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townInviteRowSchema);
  const next = townInviteRowSchema.parse({
    id: randomUUID(),
    townRef: input.townId,
    invitedBusiness,
    invitedByBrandRef: input.invitedByBrandRef,
    category,
    inviteCode,
    contactPreference,
    invitedPhone,
    invitedEmail,
    status,
    createdAt: new Date().toISOString(),
  });
  rows.push(next);
  await atomicWriteJson(filePath, rows.slice(-8000));
  return next;
}

export async function listTownInvites(input: {
  townId: string;
  userId?: string;
  limit?: number;
}): Promise<z.infer<typeof townInviteRowSchema>[]> {
  const max = Math.max(1, Math.min(200, input.limit ?? 40));
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_invites")
      .select("*")
      .eq("town_ref", input.townId)
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownInviteRow[]).map(toTownInviteRow);
  }
  const rows = await readLocalArray(localTownInvitesPath(), townInviteRowSchema);
  return rows
    .filter((row) => row.townRef === input.townId)
    .map((row) =>
      townInviteRowSchema.parse({
        ...row,
        inviteCode: normalizeInviteCode(row.inviteCode ?? row.id.slice(0, 12)),
      }),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

export async function findTownInviteByCode(input: {
  townId: string;
  code: string;
}): Promise<z.infer<typeof townInviteRowSchema> | null> {
  const normalizedCode = normalizeInviteCode(input.code);
  if (!normalizedCode) {
    return null;
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_invites")
      .select("*")
      .eq("town_ref", input.townId)
      .ilike("invite_code", normalizedCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toTownInviteRow(data as SupabaseTownInviteRow);
  }
  const rows = await readLocalArray(localTownInvitesPath(), townInviteRowSchema);
  const found = rows.find((row) => {
    if (row.townRef !== input.townId) {
      return false;
    }
    const rowCode = normalizeInviteCode(row.inviteCode ?? row.id.slice(0, 12));
    return rowCode === normalizedCode;
  });
  if (!found) {
    return null;
  }
  return townInviteRowSchema.parse({
    ...found,
    inviteCode: normalizeInviteCode(found.inviteCode ?? found.id.slice(0, 12)),
  });
}

export async function updateTownInvite(input: {
  inviteId: string;
  updates: {
    invitedBusiness?: string;
    contactPreference?: "sms" | "email";
    invitedPhone?: string | null;
    invitedEmail?: string | null;
    inviteCode?: string;
    status?: "pending" | "sent" | "accepted" | "declined";
  };
}): Promise<z.infer<typeof townInviteRowSchema> | null> {
  const nextBusiness = input.updates.invitedBusiness?.trim();
  const nextContactPreference =
    input.updates.contactPreference === "sms" || input.updates.contactPreference === "email"
      ? input.updates.contactPreference
      : undefined;
  const nextInviteCode = input.updates.inviteCode ? safeInviteCode(input.updates.inviteCode) : undefined;
  const nextPhone = input.updates.invitedPhone === null ? null : input.updates.invitedPhone?.trim() || undefined;
  const nextEmail = input.updates.invitedEmail === null ? null : input.updates.invitedEmail?.trim() || undefined;
  const nextStatus = input.updates.status ? safeInviteStatus(input.updates.status) : undefined;

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const patch: Record<string, unknown> = {};
    if (nextBusiness) patch.invited_business = nextBusiness;
    if (nextContactPreference) patch.contact_preference = nextContactPreference;
    if (input.updates.invitedPhone !== undefined) patch.invited_phone = nextPhone ?? null;
    if (input.updates.invitedEmail !== undefined) patch.invited_email = nextEmail ?? null;
    if (nextInviteCode) patch.invite_code = nextInviteCode;
    if (nextStatus) patch.status = nextStatus;
    if (Object.keys(patch).length === 0) {
      const { data, error } = await table("town_invites").select("*").eq("id", input.inviteId).maybeSingle();
      if (error) {
        throw error;
      }
      return data ? toTownInviteRow(data as SupabaseTownInviteRow) : null;
    }
    const { data, error } = await table("town_invites")
      .update(patch)
      .eq("id", input.inviteId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toTownInviteRow(data as SupabaseTownInviteRow) : null;
  }

  const filePath = localTownInvitesPath();
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townInviteRowSchema);
  const index = rows.findIndex((row) => row.id === input.inviteId);
  if (index < 0) {
    return null;
  }
  const merged = townInviteRowSchema.parse({
    ...rows[index],
    invitedBusiness: nextBusiness ?? rows[index].invitedBusiness,
    contactPreference: nextContactPreference ?? rows[index].contactPreference,
    invitedPhone: input.updates.invitedPhone !== undefined ? nextPhone ?? undefined : rows[index].invitedPhone,
    invitedEmail: input.updates.invitedEmail !== undefined ? nextEmail ?? undefined : rows[index].invitedEmail,
    inviteCode: nextInviteCode ?? rows[index].inviteCode ?? safeInviteCode(rows[index].id),
    status: nextStatus ?? rows[index].status,
  });
  rows[index] = merged;
  await atomicWriteJson(filePath, rows.slice(-8000));
  return merged;
}

export async function resolveInviterBrandByRef(input: {
  brandRef: string;
}): Promise<{ ownerId: string; brandId: string; businessName: string; status: BrandLifecycleStatus } | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("brands")
      .select("id, owner_id, brand_id, business_name, status")
      .eq("id", input.brandRef)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data ?? null) as {
      owner_id?: string;
      brand_id?: string;
      business_name?: string;
      status?: string | null;
    } | null;
    if (!row?.owner_id || !row?.brand_id) {
      return null;
    }
    return {
      ownerId: row.owner_id,
      brandId: row.brand_id,
      businessName: typeof row.business_name === "string" ? row.business_name : row.brand_id,
      status: safeLifecycleStatus(row.status),
    };
  }
  const parsed = parseLocalBrandRef(input.brandRef);
  if (!parsed) {
    return null;
  }
  const brand = await getAdapter().getBrand(parsed.ownerId, parsed.brandId);
  if (!brand) {
    return null;
  }
  return {
    ownerId: parsed.ownerId,
    brandId: brand.brandId,
    businessName: brand.businessName,
    status: safeLifecycleStatus(brand.status),
  };
}

export async function listTownPartners(input: {
  townId: string;
  userId?: string;
}): Promise<
  Array<{
    id: string;
    sponsorName: string;
    role: z.infer<typeof communitySponsorRoleSchema>;
    sponsoredSeats: number;
    active: boolean;
    createdAt: string;
  }>
> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("community_sponsors")
      .select("*")
      .eq("town_ref", input.townId)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseCommunitySponsorRow[]).map((row) => ({
      id: row.id,
      sponsorName: row.sponsor_name,
      role: safeSponsorRole(row.role),
      sponsoredSeats: Math.max(0, Math.trunc(Number(row.sponsored_seats ?? 0))),
      active: Boolean(row.active),
      createdAt: row.created_at,
    }));
  }
  const rows = await readLocalArray(
    localCommunitySponsorsPath(),
    z.object({
      id: z.string().min(1),
      townRef: z.string().min(1),
      sponsorName: z.string().min(1),
      role: communitySponsorRoleSchema.default("nonprofit"),
      sponsoredSeats: z.number().int().min(0).default(0),
      active: z.boolean().default(true),
      createdAt: z.string().datetime({ offset: true }),
    }),
  );
  return rows
    .filter((row) => row.townRef === input.townId && row.active)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => ({
      id: row.id,
      sponsorName: row.sponsorName,
      role: row.role,
      sponsoredSeats: row.sponsoredSeats,
      active: row.active,
      createdAt: row.createdAt,
    }));
}

export function townInviteMessage(input: {
  townName: string;
  invitedBusiness: string;
  invitedByBusiness: string;
  joinUrl?: string;
}): string {
  return [
    `Hi ${input.invitedBusiness},`,
    "",
    "A few local businesses are trying something new to support Main Street.",
    `${input.invitedByBusiness} thought you might want to take a look too.`,
    "",
    "This is not ads or marketing tricks.",
    "It is a simple daily assistant built to help local owners stay busy in real life.",
    "",
    `Town: ${input.townName}`,
    input.joinUrl ? `Join link: ${input.joinUrl}` : "",
    "",
    "If you'd like, we can share a short walkthrough.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function recordTownSuccessSignal(input: {
  townId: string;
  signal: TownSuccessSignal;
  weight?: number;
  createdAt?: string;
}): Promise<z.infer<typeof townSuccessSignalRowSchema>> {
  const weight = Math.max(0.01, Math.min(1000, Number(input.weight ?? 1)));
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_success_signals")
      .insert({
        town_ref: input.townId,
        signal: input.signal,
        weight,
        created_at: createdAt,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownSuccessSignalRow(data as SupabaseTownSuccessSignalRow);
  }
  const filePath = localTownSuccessSignalsPath();
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townSuccessSignalRowSchema);
  const next = townSuccessSignalRowSchema.parse({
    id: randomUUID(),
    townRef: input.townId,
    signal: input.signal,
    weight,
    createdAt,
  });
  rows.push(next);
  await atomicWriteJson(filePath, rows.slice(-12000));
  return next;
}

export async function recordTownSuccessSignalForBrand(input: {
  userId: string;
  brand: BrandProfile | null;
  signal: TownSuccessSignal;
  weight?: number;
  createdAt?: string;
}): Promise<z.infer<typeof townSuccessSignalRowSchema> | null> {
  if (!input.brand?.townRef) {
    return null;
  }
  return recordTownSuccessSignal({
    townId: input.brand.townRef,
    signal: input.signal,
    weight: input.weight,
    createdAt: input.createdAt,
  });
}

export async function listTownSuccessSignals(input: {
  townId: string;
  userId?: string;
  sinceDays?: number;
  limit?: number;
}): Promise<z.infer<typeof townSuccessSignalRowSchema>[]> {
  const sinceDays = Math.max(1, Math.min(365, input.sinceDays ?? 45));
  const max = Math.max(1, Math.min(2000, input.limit ?? 400));
  const cutoffMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_success_signals")
      .select("*")
      .eq("town_ref", input.townId)
      .gte("created_at", new Date(cutoffMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownSuccessSignalRow[]).map(toTownSuccessSignalRow);
  }
  const rows = await readLocalArray(localTownSuccessSignalsPath(), townSuccessSignalRowSchema);
  return rows
    .filter((row) => {
      if (row.townRef !== input.townId) {
        return false;
      }
      const createdMs = new Date(row.createdAt).getTime();
      return Number.isFinite(createdMs) && createdMs >= cutoffMs;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

export async function summarizeTownSuccessSignals(input: {
  townId: string;
  userId?: string;
  sinceDays?: number;
}): Promise<{
  confidence: "low" | "medium" | "high";
  totalWeight: number;
  bySignal: Array<{ signal: TownSuccessSignal; weight: number }>;
}> {
  const rows = await listTownSuccessSignals({
    townId: input.townId,
    userId: input.userId,
    sinceDays: input.sinceDays ?? 45,
    limit: 1000,
  });
  const bySignalMap = new Map<TownSuccessSignal, number>();
  for (const row of rows) {
    bySignalMap.set(row.signal, (bySignalMap.get(row.signal) ?? 0) + row.weight);
  }
  const bySignal = [...bySignalMap.entries()]
    .map(([signal, weight]) => ({
      signal,
      weight: Number(weight.toFixed(2)),
    }))
    .sort((a, b) => b.weight - a.weight);
  const totalWeight = Number(bySignal.reduce((sum, entry) => sum + entry.weight, 0).toFixed(2));
  const confidence = totalWeight >= 18 ? "high" : totalWeight >= 7 ? "medium" : "low";
  return {
    confidence,
    totalWeight,
    bySignal,
  };
}
