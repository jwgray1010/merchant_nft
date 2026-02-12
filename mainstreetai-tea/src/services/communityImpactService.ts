import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { brandProfileSchema, brandSupportLevelSchema, type BrandSupportLevel } from "../schemas/brandSchema";
import {
  communityImpactSummarySchema,
  communitySponsorRowSchema,
  sponsoredMembershipRowSchema,
  type CommunityImpactSummary,
  type CommunitySponsorRow,
  type SponsoredMembershipRow,
} from "../schemas/communityImpactSchema";
import { townMembershipSchema } from "../schemas/townSchema";
import { getStorageMode, getAdapter } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { getTownPulseModel } from "./townPulseService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const REDUCED_COST_UPGRADE_PATH = "/pricing?plan=starter&mode=community";

type SupabaseBrandContextRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  town_ref: string | null;
  support_level: string | null;
  type: string;
};

type SupabaseTownMembershipRow = {
  brand_ref: string;
  participation_level: string;
};

type SupabaseCommunitySponsorRow = {
  id: string;
  town_ref: string;
  sponsor_name: string;
  sponsored_seats: number;
  active: boolean;
  created_at: string;
};

type SupabaseSponsoredMembershipRow = {
  id: string;
  sponsor_ref: string;
  brand_ref: string;
  status: string;
  created_at: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(userId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(userId));
}

function localCommunitySponsorsPath(): string {
  return path.join(LOCAL_ROOT, "community_sponsors.json");
}

function localSponsoredMembershipsPath(): string {
  return path.join(LOCAL_ROOT, "sponsored_memberships.json");
}

function localTownMembershipsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_memberships.json");
}

function localBrandPath(userId: string, brandId: string): string {
  return path.join(localUserDir(userId), "brands", `${brandId}.json`);
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

function safeSupportLevel(value: unknown): BrandSupportLevel {
  const parsed = brandSupportLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : "steady";
}

function safeMembershipStatus(value: unknown): "active" | "paused" | "ended" {
  const parsed = sponsoredMembershipRowSchema.shape.status.safeParse(value);
  return parsed.success ? parsed.data : "active";
}

function toCommunitySponsorRow(row: SupabaseCommunitySponsorRow): CommunitySponsorRow {
  return communitySponsorRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    sponsorName: row.sponsor_name,
    sponsoredSeats: Math.max(0, Math.trunc(Number(row.sponsored_seats ?? 0))),
    active: Boolean(row.active),
    createdAt: row.created_at,
  });
}

function toSponsoredMembershipRow(row: SupabaseSponsoredMembershipRow): SponsoredMembershipRow {
  return sponsoredMembershipRowSchema.parse({
    id: row.id,
    sponsorRef: row.sponsor_ref,
    brandRef: row.brand_ref,
    status: safeMembershipStatus(row.status),
    createdAt: row.created_at,
  });
}

function categoryBucket(businessType: string): "retail" | "food" | "service" {
  const normalized = businessType.trim().toLowerCase();
  if (normalized === "retail") {
    return "retail";
  }
  if (
    normalized === "cafe" ||
    normalized === "restaurant" ||
    normalized === "loaded-tea" ||
    normalized === "food"
  ) {
    return "food";
  }
  return "service";
}

function deriveTownPulseEnergy(input: {
  busyWindows?: unknown;
  slowWindows?: unknown;
  eventEnergy?: unknown;
} | null): "low" | "medium" | "high" {
  const busy = Array.isArray(input?.busyWindows) ? input.busyWindows.length : 0;
  const slow = Array.isArray(input?.slowWindows) ? input.slowWindows.length : 0;
  const eventEnergy = typeof input?.eventEnergy === "string" ? input.eventEnergy : "low";
  const eventBoost = eventEnergy === "high" ? 2.5 : eventEnergy === "medium" ? 1 : 0;
  const score = busy * 1.2 + eventBoost - slow * 0.4;
  if (score >= 5.5) return "high";
  if (score >= 2) return "medium";
  return "low";
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

async function listLocalTownBrands(
  townId: string,
): Promise<Array<{ ownerId: string; brandId: string; supportLevel: BrandSupportLevel; type: string }>> {
  const users = await listLocalUsers();
  const rows: Array<{ ownerId: string; brandId: string; supportLevel: BrandSupportLevel; type: string }> = [];
  for (const ownerId of users) {
    const memberships = await readLocalArray(localTownMembershipsPath(ownerId), townMembershipSchema);
    const brandIds = new Set(
      memberships
        .filter((membership) => membership.townRef === townId && membership.participationLevel !== "hidden")
        .map((membership) => membership.brandRef),
    );
    for (const brandId of brandIds.values()) {
      const raw = await readJsonOrNull<unknown>(localBrandPath(ownerId, brandId));
      const parsed = brandProfileSchema.safeParse(raw);
      if (!parsed.success) {
        continue;
      }
      rows.push({
        ownerId,
        brandId,
        supportLevel: parsed.data.supportLevel,
        type: parsed.data.type,
      });
    }
  }
  return rows;
}

async function resolveBrandContext(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ brandRef: string; townRef: string | null; supportLevel: BrandSupportLevel } | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("brands")
      .select("id, owner_id, brand_id, town_ref, support_level, type")
      .eq("owner_id", input.ownerId)
      .eq("brand_id", input.brandId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data as SupabaseBrandContextRow | null) ?? null;
    if (!row) {
      return null;
    }
    return {
      brandRef: row.id,
      townRef: row.town_ref ?? null,
      supportLevel: safeSupportLevel(row.support_level),
    };
  }

  const brand = await getAdapter().getBrand(input.ownerId, input.brandId);
  if (!brand) {
    return null;
  }
  return {
    brandRef: localBrandRef(input.ownerId, input.brandId),
    townRef: brand.townRef ?? null,
    supportLevel: brand.supportLevel,
  };
}

async function listActiveSponsorsForTown(input: {
  townId: string;
  userId?: string;
}): Promise<CommunitySponsorRow[]> {
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
    return ((data ?? []) as SupabaseCommunitySponsorRow[]).map(toCommunitySponsorRow);
  }

  const rows = await readLocalArray(localCommunitySponsorsPath(), communitySponsorRowSchema);
  return rows
    .filter((row) => row.townRef === input.townId && row.active)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

async function countActiveMembershipsBySponsor(
  sponsorIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (sponsorIds.length === 0) {
    return counts;
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("sponsored_memberships")
      .select("sponsor_ref,status")
      .in("sponsor_ref", sponsorIds)
      .eq("status", "active");
    if (error) {
      throw error;
    }
    for (const row of (data ?? []) as Array<{ sponsor_ref?: unknown }>) {
      const sponsorRef = typeof row.sponsor_ref === "string" ? row.sponsor_ref : "";
      if (!sponsorRef) {
        continue;
      }
      counts.set(sponsorRef, (counts.get(sponsorRef) ?? 0) + 1);
    }
    return counts;
  }

  const rows = await readLocalArray(localSponsoredMembershipsPath(), sponsoredMembershipRowSchema);
  for (const row of rows) {
    if (row.status !== "active") {
      continue;
    }
    if (!sponsorIds.includes(row.sponsorRef)) {
      continue;
    }
    counts.set(row.sponsorRef, (counts.get(row.sponsorRef) ?? 0) + 1);
  }
  return counts;
}

async function upsertSponsoredMembership(input: {
  sponsorRef: string;
  brandRef: string;
}): Promise<SponsoredMembershipRow> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("sponsored_memberships")
      .upsert(
        {
          sponsor_ref: input.sponsorRef,
          brand_ref: input.brandRef,
          status: "active",
        },
        { onConflict: "brand_ref" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toSponsoredMembershipRow(data as SupabaseSponsoredMembershipRow);
  }

  const filePath = localSponsoredMembershipsPath();
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, sponsoredMembershipRowSchema);
  const index = rows.findIndex((row) => row.brandRef === input.brandRef);
  const next = sponsoredMembershipRowSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    sponsorRef: input.sponsorRef,
    brandRef: input.brandRef,
    status: "active",
    createdAt: index >= 0 ? rows[index].createdAt : new Date().toISOString(),
  });
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(filePath, rows.slice(-8000));
  return next;
}

export async function getActiveSponsoredMembershipForBrand(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ membership: SponsoredMembershipRow; sponsor: CommunitySponsorRow } | null> {
  const brandContext = await resolveBrandContext(input);
  if (!brandContext) {
    return null;
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("sponsored_memberships")
      .select("*, community_sponsors!inner(*)")
      .eq("brand_ref", brandContext.brandRef)
      .eq("status", "active")
      .eq("community_sponsors.active", true)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    const row = data as {
      id: string;
      sponsor_ref: string;
      brand_ref: string;
      status: string;
      created_at: string;
      community_sponsors?: unknown;
    };
    const sponsor = toCommunitySponsorRow(row.community_sponsors as SupabaseCommunitySponsorRow);
    const membership = toSponsoredMembershipRow({
      id: row.id,
      sponsor_ref: row.sponsor_ref,
      brand_ref: row.brand_ref,
      status: row.status,
      created_at: row.created_at,
    });
    return { membership, sponsor };
  }

  const memberships = await readLocalArray(localSponsoredMembershipsPath(), sponsoredMembershipRowSchema);
  const match = memberships.find(
    (membership) => membership.brandRef === brandContext.brandRef && membership.status === "active",
  );
  if (!match) {
    return null;
  }
  const sponsors = await readLocalArray(localCommunitySponsorsPath(), communitySponsorRowSchema);
  const sponsor = sponsors.find((entry) => entry.id === match.sponsorRef && entry.active);
  if (!sponsor) {
    return null;
  }
  return {
    membership: match,
    sponsor,
  };
}

export async function assignSponsoredSeatForBrand(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ membership: SponsoredMembershipRow; sponsor: CommunitySponsorRow } | null> {
  const brandContext = await resolveBrandContext(input);
  if (!brandContext) {
    return null;
  }
  if (brandContext.supportLevel !== "struggling" || !brandContext.townRef) {
    return null;
  }

  const existing = await getActiveSponsoredMembershipForBrand(input);
  if (existing) {
    return existing;
  }

  const sponsors = await listActiveSponsorsForTown({
    townId: brandContext.townRef,
    userId: input.ownerId,
  });
  if (sponsors.length === 0) {
    return null;
  }

  const usage = await countActiveMembershipsBySponsor(sponsors.map((sponsor) => sponsor.id));
  const sponsorWithSeats = sponsors
    .map((sponsor) => ({
      sponsor,
      used: usage.get(sponsor.id) ?? 0,
      remaining: Math.max(0, sponsor.sponsoredSeats - (usage.get(sponsor.id) ?? 0)),
    }))
    .filter((entry) => entry.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining || a.sponsor.createdAt.localeCompare(b.sponsor.createdAt))[0];

  if (!sponsorWithSeats) {
    return null;
  }

  const membership = await upsertSponsoredMembership({
    sponsorRef: sponsorWithSeats.sponsor.id,
    brandRef: brandContext.brandRef,
  });
  return {
    membership,
    sponsor: sponsorWithSeats.sponsor,
  };
}

async function collectTownBusinessStats(input: {
  townId: string;
  userId?: string;
}): Promise<{
  activeBusinesses: number;
  strugglingBusinesses: number;
  topCategories: string[];
}> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data: membershipsData, error: membershipsError } = await table("town_memberships")
      .select("brand_ref, participation_level")
      .eq("town_ref", input.townId)
      .neq("participation_level", "hidden");
    if (membershipsError) {
      throw membershipsError;
    }
    const memberships = (membershipsData ?? []) as SupabaseTownMembershipRow[];
    const brandRefs = [...new Set(memberships.map((entry) => entry.brand_ref).filter(Boolean))];
    if (brandRefs.length === 0) {
      return {
        activeBusinesses: 0,
        strugglingBusinesses: 0,
        topCategories: [],
      };
    }
    const { data: brandsData, error: brandsError } = await table("brands")
      .select("id, type, support_level")
      .in("id", brandRefs);
    if (brandsError) {
      throw brandsError;
    }
    const categoryCounts = new Map<string, number>();
    let strugglingBusinesses = 0;
    for (const row of (brandsData ?? []) as Array<{ type?: unknown; support_level?: unknown }>) {
      const type = typeof row.type === "string" ? row.type : "other";
      const bucket = categoryBucket(type);
      categoryCounts.set(bucket, (categoryCounts.get(bucket) ?? 0) + 1);
      if (safeSupportLevel(row.support_level) === "struggling") {
        strugglingBusinesses += 1;
      }
    }
    const topCategories = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name]) => name);
    return {
      activeBusinesses: brandRefs.length,
      strugglingBusinesses,
      topCategories,
    };
  }

  const localBrands = await listLocalTownBrands(input.townId);
  const categoryCounts = new Map<string, number>();
  let strugglingBusinesses = 0;
  for (const brand of localBrands) {
    const bucket = categoryBucket(brand.type);
    categoryCounts.set(bucket, (categoryCounts.get(bucket) ?? 0) + 1);
    if (brand.supportLevel === "struggling") {
      strugglingBusinesses += 1;
    }
  }
  const topCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => name);
  return {
    activeBusinesses: localBrands.length,
    strugglingBusinesses,
    topCategories,
  };
}

export async function countActiveBusinessesForTown(input: {
  townId: string;
  userId?: string;
}): Promise<number> {
  const stats = await collectTownBusinessStats(input);
  return stats.activeBusinesses;
}

export async function getTownSponsorshipSeatStatus(input: {
  townId: string;
  userId?: string;
}): Promise<{
  activeSponsors: number;
  totalSeats: number;
  activeSponsoredBusinesses: number;
  seatsRemaining: number;
}> {
  const sponsors = await listActiveSponsorsForTown(input);
  if (sponsors.length === 0) {
    return {
      activeSponsors: 0,
      totalSeats: 0,
      activeSponsoredBusinesses: 0,
      seatsRemaining: 0,
    };
  }
  const usage = await countActiveMembershipsBySponsor(sponsors.map((sponsor) => sponsor.id));
  const totalSeats = sponsors.reduce((sum, sponsor) => sum + sponsor.sponsoredSeats, 0);
  const activeSponsoredBusinesses = [...usage.values()].reduce((sum, count) => sum + count, 0);
  return {
    activeSponsors: sponsors.length,
    totalSeats,
    activeSponsoredBusinesses,
    seatsRemaining: Math.max(0, totalSeats - activeSponsoredBusinesses),
  };
}

export async function getCommunitySupportStatusForBrand(input: {
  ownerId: string;
  brandId: string;
  autoAssign?: boolean;
}): Promise<{
  supportLevel: BrandSupportLevel;
  eligibleForSponsorship: boolean;
  sponsored: boolean;
  sponsorName?: string;
  seatsRemaining: number;
  reducedCostUpgradePath: string;
}> {
  const brandContext = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!brandContext) {
    return {
      supportLevel: "steady",
      eligibleForSponsorship: false,
      sponsored: false,
      seatsRemaining: 0,
      reducedCostUpgradePath: REDUCED_COST_UPGRADE_PATH,
    };
  }

  let active = await getActiveSponsoredMembershipForBrand({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!active && input.autoAssign) {
    active = await assignSponsoredSeatForBrand({
      ownerId: input.ownerId,
      brandId: input.brandId,
    });
  }

  const eligibleForSponsorship =
    brandContext.supportLevel === "struggling" && Boolean(brandContext.townRef);
  const seats = brandContext.townRef
    ? await getTownSponsorshipSeatStatus({
        townId: brandContext.townRef,
        userId: input.ownerId,
      })
    : {
        activeSponsors: 0,
        totalSeats: 0,
        activeSponsoredBusinesses: 0,
        seatsRemaining: 0,
      };

  return {
    supportLevel: brandContext.supportLevel,
    eligibleForSponsorship,
    sponsored: Boolean(active),
    sponsorName: active?.sponsor.sponsorName,
    seatsRemaining: seats.seatsRemaining,
    reducedCostUpgradePath: REDUCED_COST_UPGRADE_PATH,
  };
}

export async function summarizeCommunityImpactForTown(input: {
  townId: string;
  userId?: string;
}): Promise<CommunityImpactSummary> {
  const [businessStats, pulse, seatStatus] = await Promise.all([
    collectTownBusinessStats(input),
    getTownPulseModel({
      townId: input.townId,
      userId: input.userId,
    }).catch(() => null),
    getTownSponsorshipSeatStatus(input),
  ]);

  const waitlistNeeded =
    seatStatus.activeSponsors > 0 &&
    seatStatus.seatsRemaining === 0 &&
    businessStats.strugglingBusinesses > seatStatus.activeSponsoredBusinesses;

  return communityImpactSummarySchema.parse({
    activeBusinesses: businessStats.activeBusinesses,
    townPulseEnergy: deriveTownPulseEnergy(pulse?.model ?? null),
    topCategories: businessStats.topCategories,
    sponsorship: {
      activeSponsors: seatStatus.activeSponsors,
      totalSeats: seatStatus.totalSeats,
      activeSponsoredBusinesses: seatStatus.activeSponsoredBusinesses,
      seatsRemaining: seatStatus.seatsRemaining,
      strugglingBusinesses: businessStats.strugglingBusinesses,
      waitlistNeeded,
    },
  });
}
