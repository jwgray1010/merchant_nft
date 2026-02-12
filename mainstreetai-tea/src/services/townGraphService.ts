import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import { type BrandProfile, brandProfileSchema } from "../schemas/brandSchema";
import {
  brandPartnerRecordSchema,
  brandPartnerRelationshipSchema,
  townGraphEdgeSchema,
  townGraphPromptOutputSchema,
  townGraphSuggestionRowSchema,
  type TownGraphCategory,
  type TownGraphEdge,
} from "../schemas/townGraphSchema";
import { townRecordSchema, type TownRecord } from "../schemas/townSchema";
import { type TownPulseModelData, townPulseModelDataSchema } from "../schemas/townPulseSchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { listActiveTownPulseTargets } from "./townPulseService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const TOWN_GRAPH_STALE_HOURS = 22;

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

type SupabaseBrandRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  business_name: string;
  type: string;
  town_ref: string | null;
};

type SupabaseTownGraphEdgeRow = {
  id: string;
  town_ref: string;
  from_category: string;
  to_category: string;
  weight: number;
  updated_at: string;
};

type SupabaseBrandPartnerRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  partner_brand_ref: string;
  relationship: string;
  created_at: string;
};

const CATEGORY_ORDER: TownGraphCategory[] = [
  "cafe",
  "fitness",
  "salon",
  "retail",
  "service",
  "food",
  "other",
];

export const TOWN_GRAPH_CATEGORIES = CATEGORY_ORDER;

const CATEGORY_LABEL: Record<TownGraphCategory, string> = {
  cafe: "Coffee / Cafe",
  fitness: "Fitness",
  salon: "Salon / Beauty",
  retail: "Retail",
  service: "Services",
  food: "Food",
  other: "Local stop",
};

const CATEGORY_HINTS: Array<{ category: TownGraphCategory; patterns: RegExp[] }> = [
  {
    category: "fitness",
    patterns: [/\bgym\b/i, /\bworkout\b/i, /\btraining\b/i, /\bclass(es)?\b/i, /\bfit(ness)?\b/i],
  },
  {
    category: "salon",
    patterns: [/\bsalon\b/i, /\bspa\b/i, /\bhair\b/i, /\bnail(s)?\b/i, /\bbarber\b/i, /\bbeauty\b/i],
  },
  {
    category: "cafe",
    patterns: [/\bcoffee\b/i, /\bcafe\b/i, /\btea\b/i, /\blatte\b/i, /\bespresso\b/i, /\bsmoothie\b/i],
  },
  {
    category: "food",
    patterns: [/\blunch\b/i, /\bdinner\b/i, /\brestaurant\b/i, /\bmeal\b/i, /\bbakery\b/i, /\bbite\b/i],
  },
  {
    category: "retail",
    patterns: [/\bretail\b/i, /\bboutique\b/i, /\bshop\b/i, /\bgift\b/i, /\bstore\b/i],
  },
  {
    category: "service",
    patterns: [/\bservice\b/i, /\brepair\b/i, /\bappointment\b/i, /\bdetailing\b/i, /\bclinic\b/i],
  },
];

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(userId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(userId));
}

function localTownsPath(userId: string): string {
  return path.join(localUserDir(userId), "towns.json");
}

function localBrandPath(userId: string, brandId: string): string {
  return path.join(localUserDir(userId), "brands", `${brandId}.json`);
}

function localEdgesPath(userId: string): string {
  return path.join(localUserDir(userId), "town_graph_edges.json");
}

function localSuggestionsPath(userId: string): string {
  return path.join(localUserDir(userId), "town_graph_suggestions.json");
}

function localPartnersPath(userId: string): string {
  return path.join(localUserDir(userId), "brand_partners.json");
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

function toTownGraphEdge(row: SupabaseTownGraphEdgeRow): TownGraphEdge {
  return townGraphEdgeSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    fromCategory: row.from_category,
    toCategory: row.to_category,
    weight: Number(row.weight ?? 1),
    updatedAt: row.updated_at,
  });
}

function toWeight(value: number | undefined, fallback = 1): number {
  const candidate = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(0.01, Math.min(1000, candidate));
}

function isStale(iso: string, maxAgeHours: number): boolean {
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return Date.now() - parsed > maxAgeHours * 60 * 60 * 1000;
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
  return towns.find((entry) => entry.id === input.townId) ?? null;
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

async function supabaseFindOwnedBrand(userId: string, brandId: string): Promise<SupabaseBrandRow | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id, owner_id, brand_id, business_name, type, town_ref")
    .eq("owner_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as SupabaseBrandRow | null) ?? null;
}

export function townGraphCategoryLabel(category: TownGraphCategory): string {
  return CATEGORY_LABEL[category];
}

export function townGraphCategoryFromBrandType(type: string): TownGraphCategory {
  const normalized = type.trim().toLowerCase();
  if (normalized === "loaded-tea" || normalized === "cafe") return "cafe";
  if (normalized === "fitness-hybrid" || normalized === "gym") return "fitness";
  if (normalized === "salon") return "salon";
  if (normalized === "retail") return "retail";
  if (normalized === "restaurant" || normalized === "food") return "food";
  if (normalized === "service" || normalized === "barber" || normalized === "auto") return "service";
  return "other";
}

export function inferTownGraphCategoryFromText(text: string): TownGraphCategory | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  for (const entry of CATEGORY_HINTS) {
    if (entry.patterns.some((pattern) => pattern.test(raw))) {
      return entry.category;
    }
  }
  return null;
}

async function readTownGraphEdge(input: {
  townId: string;
  fromCategory: TownGraphCategory;
  toCategory: TownGraphCategory;
  userId?: string;
}): Promise<TownGraphEdge | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_graph_edges")
      .select("*")
      .eq("town_ref", input.townId)
      .eq("from_category", input.fromCategory)
      .eq("to_category", input.toCategory)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toTownGraphEdge(data as SupabaseTownGraphEdgeRow) : null;
  }
  if (!input.userId) {
    return null;
  }
  const rows = await readLocalArray(localEdgesPath(input.userId), townGraphEdgeSchema);
  return (
    rows.find(
      (row) =>
        row.townRef === input.townId &&
        row.fromCategory === input.fromCategory &&
        row.toCategory === input.toCategory,
    ) ?? null
  );
}

export async function addTownGraphEdge(input: {
  townId: string;
  fromCategory: TownGraphCategory;
  toCategory: TownGraphCategory;
  weight?: number;
  userId?: string;
  mode?: "increment" | "ensure";
}): Promise<TownGraphEdge | null> {
  if (input.fromCategory === input.toCategory) {
    return null;
  }
  const weight = toWeight(input.weight, 1);
  const mode = input.mode ?? "increment";
  const nowIso = new Date().toISOString();
  const existing = await readTownGraphEdge({
    townId: input.townId,
    fromCategory: input.fromCategory,
    toCategory: input.toCategory,
    userId: input.userId,
  });

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    if (existing) {
      const nextWeight = mode === "ensure" ? existing.weight : existing.weight + weight;
      const { data, error } = await table("town_graph_edges")
        .update({
          weight: nextWeight,
          updated_at: nowIso,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return toTownGraphEdge(data as SupabaseTownGraphEdgeRow);
    }
    const { data, error } = await table("town_graph_edges")
      .insert({
        town_ref: input.townId,
        from_category: input.fromCategory,
        to_category: input.toCategory,
        weight,
        updated_at: nowIso,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownGraphEdge(data as SupabaseTownGraphEdgeRow);
  }

  const userId = input.userId;
  if (!userId) {
    return null;
  }
  const filePath = localEdgesPath(userId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townGraphEdgeSchema);
  const index = rows.findIndex(
    (row) =>
      row.townRef === input.townId &&
      row.fromCategory === input.fromCategory &&
      row.toCategory === input.toCategory,
  );
  if (index >= 0) {
    rows[index] = townGraphEdgeSchema.parse({
      ...rows[index],
      weight: mode === "ensure" ? rows[index].weight : rows[index].weight + weight,
      updatedAt: nowIso,
    });
  } else {
    rows.push(
      townGraphEdgeSchema.parse({
        id: randomUUID(),
        townRef: input.townId,
        fromCategory: input.fromCategory,
        toCategory: input.toCategory,
        weight,
        updatedAt: nowIso,
      }),
    );
  }
  await atomicWriteJson(filePath, rows.slice(-3000));
  return (
    rows.find(
      (row) =>
        row.townRef === input.townId &&
        row.fromCategory === input.fromCategory &&
        row.toCategory === input.toCategory,
    ) ?? null
  );
}

export async function listTownGraphEdges(input: {
  townId: string;
  userId?: string;
}): Promise<TownGraphEdge[]> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_graph_edges")
      .select("*")
      .eq("town_ref", input.townId)
      .order("weight", { ascending: false })
      .limit(600);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownGraphEdgeRow[]).map(toTownGraphEdge);
  }
  if (!input.userId) {
    return [];
  }
  const rows = await readLocalArray(localEdgesPath(input.userId), townGraphEdgeSchema);
  return rows
    .filter((entry) => entry.townRef === input.townId)
    .sort((a, b) => b.weight - a.weight);
}

export async function listTopEdgesFromCategory(input: {
  townId: string;
  fromCategory: TownGraphCategory;
  limit?: number;
  userId?: string;
}): Promise<Array<{ to: TownGraphCategory; weight: number }>> {
  const max = Math.max(1, Math.min(10, input.limit ?? 3));
  const edges = await listTownGraphEdges({
    townId: input.townId,
    userId: input.userId,
  });
  return edges
    .filter((edge) => edge.fromCategory === input.fromCategory)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map((edge) => ({
      to: edge.toCategory,
      weight: edge.weight,
    }));
}

export async function getTownGraph(input: {
  townId: string;
  userId?: string;
}): Promise<{
  nodes: TownGraphCategory[];
  edges: Array<{ from: TownGraphCategory; to: TownGraphCategory; weight: number }>;
}> {
  const edges = await listTownGraphEdges({
    townId: input.townId,
    userId: input.userId,
  });
  const nodeSet = new Set<TownGraphCategory>();
  for (const edge of edges) {
    nodeSet.add(edge.fromCategory);
    nodeSet.add(edge.toCategory);
  }
  return {
    nodes: CATEGORY_ORDER.filter((category) => nodeSet.has(category)),
    edges: edges.map((edge) => ({
      from: edge.fromCategory,
      to: edge.toCategory,
      weight: edge.weight,
    })),
  };
}

export async function listPreferredPartnerCategoriesForBrand(input: {
  userId: string;
  brandId: string;
}): Promise<TownGraphCategory[]> {
  const brand = await getAdapter().getBrand(input.userId, input.brandId);
  if (!brand?.townRef) {
    return [];
  }
  const fromCategory = townGraphCategoryFromBrandType(brand.type);
  const top = await listTopEdgesFromCategory({
    townId: brand.townRef,
    fromCategory,
    limit: 12,
    userId: input.userId,
  });
  return top.map((entry) => entry.to);
}

export async function recordManualCategoryPreferencesForBrand(input: {
  userId: string;
  brandId: string;
  toCategories: TownGraphCategory[];
}): Promise<number> {
  const brand = await getAdapter().getBrand(input.userId, input.brandId);
  if (!brand?.townRef) {
    return 0;
  }
  const fromCategory = townGraphCategoryFromBrandType(brand.type);
  const uniqueTo = [...new Set(input.toCategories)].filter((category) => category !== fromCategory);
  let written = 0;
  for (const category of uniqueTo) {
    const row = await addTownGraphEdge({
      townId: brand.townRef,
      fromCategory,
      toCategory: category,
      userId: input.userId,
      weight: 1,
      mode: "ensure",
    });
    if (row) {
      written += 1;
    }
  }
  return written;
}

export async function listExplicitPartnersForBrand(input: {
  userId: string;
  brandId: string;
}): Promise<Array<{ businessName: string; type: string; relationship: z.infer<typeof brandPartnerRelationshipSchema> }>> {
  if (getStorageMode() === "supabase") {
    const brand = await supabaseFindOwnedBrand(input.userId, input.brandId);
    if (!brand?.town_ref) {
      return [];
    }
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("brand_partners")
      .select("partner_brand_ref, relationship")
      .eq("owner_id", input.userId)
      .eq("brand_ref", brand.id);
    if (error) {
      throw error;
    }
    const rows = (data ?? []) as Array<{ partner_brand_ref?: string | null; relationship?: string | null }>;
    const partnerRefs = rows
      .map((row) => (typeof row.partner_brand_ref === "string" ? row.partner_brand_ref : ""))
      .filter((entry) => entry !== "");
    if (partnerRefs.length === 0) {
      return [];
    }
    const brandsResponse = await table("brands")
      .select("id, business_name, type, town_ref")
      .in("id", partnerRefs)
      .eq("town_ref", brand.town_ref);
    if (brandsResponse.error) {
      throw brandsResponse.error;
    }
    const partnersById = new Map<string, { businessName: string; type: string }>();
    for (const row of (brandsResponse.data ?? []) as Array<Record<string, unknown>>) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      partnersById.set(id, {
        businessName: typeof row.business_name === "string" ? row.business_name : "Local partner",
        type: typeof row.type === "string" ? row.type : "other",
      });
    }
    return rows
      .map((row) => {
        const partnerRef = typeof row.partner_brand_ref === "string" ? row.partner_brand_ref : "";
        if (!partnerRef) {
          return null;
        }
        const partner = partnersById.get(partnerRef);
        if (!partner) {
          return null;
        }
        return {
          businessName: partner.businessName,
          type: partner.type,
          relationship: brandPartnerRelationshipSchema.parse(row.relationship ?? "partner"),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  const baseBrand = await localGetBrand(input.userId, input.brandId);
  if (!baseBrand?.townRef) {
    return [];
  }
  const rows = await readLocalArray(localPartnersPath(input.userId), brandPartnerRecordSchema);
  const relevant = rows.filter((row) => row.ownerId === input.userId && row.brandRef === input.brandId);
  const partners = await Promise.all(
    relevant.map(async (row) => {
      const partner = await localGetBrand(input.userId, row.partnerBrandRef);
      if (!partner || partner.townRef !== baseBrand.townRef) {
        return null;
      }
      return {
        businessName: partner.businessName,
        type: partner.type,
        relationship: row.relationship,
      };
    }),
  );
  return partners.filter((entry): entry is NonNullable<typeof partners[number]> => entry !== null);
}

export async function upsertExplicitPartnerForBrand(input: {
  userId: string;
  brandId: string;
  partnerBrandRef: string;
  relationship?: z.infer<typeof brandPartnerRelationshipSchema>;
}): Promise<z.infer<typeof brandPartnerRecordSchema> | null> {
  const relationship = brandPartnerRelationshipSchema.parse(input.relationship ?? "partner");
  if (getStorageMode() === "supabase") {
    const baseBrand = await supabaseFindOwnedBrand(input.userId, input.brandId);
    if (!baseBrand?.town_ref) {
      return null;
    }
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const partnerResponse = await table("brands")
      .select("id, town_ref")
      .eq("id", input.partnerBrandRef)
      .maybeSingle();
    if (partnerResponse.error) {
      throw partnerResponse.error;
    }
    const partner = (partnerResponse.data ?? null) as { id?: string; town_ref?: string | null } | null;
    if (!partner?.id || !partner.town_ref || partner.town_ref !== baseBrand.town_ref) {
      throw new Error("Partner brand must belong to the same town");
    }
    const { data, error } = await table("brand_partners")
      .upsert(
        {
          owner_id: input.userId,
          brand_ref: baseBrand.id,
          partner_brand_ref: partner.id,
          relationship,
        },
        { onConflict: "owner_id,brand_ref,partner_brand_ref" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    const row = data as SupabaseBrandPartnerRow;
    return brandPartnerRecordSchema.parse({
      id: row.id,
      ownerId: row.owner_id,
      brandRef: row.brand_ref,
      partnerBrandRef: row.partner_brand_ref,
      relationship: row.relationship,
      createdAt: row.created_at,
    });
  }

  const brand = await localGetBrand(input.userId, input.brandId);
  const partner = await localGetBrand(input.userId, input.partnerBrandRef);
  if (!brand?.townRef || !partner?.townRef || brand.townRef !== partner.townRef) {
    throw new Error("Partner brand must belong to the same town");
  }
  const filePath = localPartnersPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, brandPartnerRecordSchema);
  const index = rows.findIndex(
    (row) =>
      row.ownerId === input.userId &&
      row.brandRef === input.brandId &&
      row.partnerBrandRef === input.partnerBrandRef,
  );
  const next = brandPartnerRecordSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    ownerId: input.userId,
    brandRef: input.brandId,
    partnerBrandRef: input.partnerBrandRef,
    relationship,
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

export async function removeExplicitPartnerForBrand(input: {
  userId: string;
  brandId: string;
  partnerBrandRef: string;
}): Promise<boolean> {
  if (getStorageMode() === "supabase") {
    const baseBrand = await supabaseFindOwnedBrand(input.userId, input.brandId);
    if (!baseBrand) {
      return false;
    }
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { error } = await table("brand_partners")
      .delete()
      .eq("owner_id", input.userId)
      .eq("brand_ref", baseBrand.id)
      .eq("partner_brand_ref", input.partnerBrandRef);
    if (error) {
      throw error;
    }
    return true;
  }
  const filePath = localPartnersPath(input.userId);
  const rows = await readLocalArray(filePath, brandPartnerRecordSchema);
  const next = rows.filter(
    (row) =>
      !(
        row.ownerId === input.userId &&
        row.brandRef === input.brandId &&
        row.partnerBrandRef === input.partnerBrandRef
      ),
  );
  if (next.length === rows.length) {
    return false;
  }
  await ensureDir(path.dirname(filePath));
  await atomicWriteJson(filePath, next);
  return true;
}

function fallbackSuggestionFromEdges(input: {
  fromCategory: TownGraphCategory;
  edges: Array<{ to: TownGraphCategory; weight: number }>;
}) {
  const fromLabel = townGraphCategoryLabel(input.fromCategory);
  const ideas = input.edges.slice(0, 3).map((edge) => {
    const toLabel = townGraphCategoryLabel(edge.to);
    return {
      idea: `After a ${fromLabel.toLowerCase()} stop, many locals keep things moving with a ${toLabel.toLowerCase()} visit.`,
      captionAddOn: `If you're nearby, pair this with a quick ${toLabel.toLowerCase()} stop in town.`,
      staffLine: `If someone asks what to do next, suggest a local ${toLabel.toLowerCase()} stop.`,
    };
  });
  const topTo = input.edges[0]?.to;
  const topToLabel = topTo ? townGraphCategoryLabel(topTo) : "local";
  return townGraphPromptOutputSchema.parse({
    nextStopIdeas: ideas.length > 0 ? ideas : [{ idea: "Keep your local stops close and simple today.", captionAddOn: "Take the local route and keep it in town.", staffLine: "Invite guests to make a couple local stops while they're out." }],
    collabSuggestion: `Connect ${fromLabel.toLowerCase()} moments with nearby ${topToLabel.toLowerCase()} routines in a natural way.`,
  });
}

async function buildPromptSuggestion(input: {
  userId: string;
  brandId: string;
  brand: BrandProfile;
  fromCategory: TownGraphCategory;
  topEdges: Array<{ to: TownGraphCategory; weight: number }>;
  townPulse?: TownPulseModelData | null;
  voiceProfile?: unknown;
}) {
  const town = await getTownById({
    townId: input.brand.townRef as string,
    userId: input.userId,
  });
  if (!town) {
    return fallbackSuggestionFromEdges({
      fromCategory: input.fromCategory,
      edges: input.topEdges,
    });
  }
  const explicitPartners = await listExplicitPartnersForBrand({
    userId: input.userId,
    brandId: input.brandId,
  }).catch(() => []);
  return runPrompt({
    promptFile: "town_graph_suggest.md",
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
      category: input.fromCategory,
      topEdgesFromCategory: input.topEdges,
      townPulse: input.townPulse ?? townPulseModelDataSchema.parse({
        busyWindows: [],
        slowWindows: [],
        eventEnergy: "low",
        seasonalNotes: "Town rhythm is still warming up.",
        categoryTrends: [],
      }),
      voiceProfile: input.voiceProfile ?? undefined,
      explicitPartners,
    },
    outputSchema: townGraphPromptOutputSchema,
  }).catch(() =>
    fallbackSuggestionFromEdges({
      fromCategory: input.fromCategory,
      edges: input.topEdges,
    }),
  );
}

export async function buildTownGraphBoostForDaily(input: {
  userId: string;
  brandId: string;
  brand: BrandProfile;
  townPulse?: TownPulseModelData | null;
  voiceProfile?: unknown;
}): Promise<{
  townGraphBoost: {
    nextStopIdea: string;
    captionAddOn: string;
    staffLine: string;
  };
  collabSuggestion?: string;
} | null> {
  if (!input.brand.townRef) {
    return null;
  }
  const fromCategory = townGraphCategoryFromBrandType(input.brand.type);
  let topEdges = await listTopEdgesFromCategory({
    townId: input.brand.townRef,
    fromCategory,
    limit: 4,
    userId: input.userId,
  });
  if (topEdges.length === 0) {
    const explicitPartners = await listExplicitPartnersForBrand({
      userId: input.userId,
      brandId: input.brandId,
    }).catch(() => []);
    const fallback = new Map<TownGraphCategory, number>();
    for (const partner of explicitPartners) {
      const to = townGraphCategoryFromBrandType(partner.type);
      if (to === fromCategory) continue;
      fallback.set(to, (fallback.get(to) ?? 0) + 1);
    }
    topEdges = [...fallback.entries()]
      .map(([to, weight]) => ({ to, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
  }
  if (topEdges.length === 0) {
    return null;
  }
  const promptOutput = await buildPromptSuggestion({
    userId: input.userId,
    brandId: input.brandId,
    brand: input.brand,
    fromCategory,
    topEdges,
    townPulse: input.townPulse ?? null,
    voiceProfile: input.voiceProfile,
  });
  const first = promptOutput.nextStopIdeas[0];
  if (!first) {
    return null;
  }
  return {
    townGraphBoost: {
      nextStopIdea: first.idea,
      captionAddOn: first.captionAddOn,
      staffLine: first.staffLine,
    },
    collabSuggestion: promptOutput.collabSuggestion,
  };
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

async function latestSuggestionComputedAt(input: {
  townId: string;
  userId?: string;
}): Promise<string | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_graph_suggestions")
      .select("computed_at")
      .eq("town_ref", input.townId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return typeof (data as { computed_at?: unknown } | null)?.computed_at === "string"
      ? ((data as { computed_at: string }).computed_at as string)
      : null;
  }
  if (!input.userId) {
    return null;
  }
  const rows = await readLocalArray(localSuggestionsPath(input.userId), townGraphSuggestionRowSchema);
  const sorted = rows
    .filter((row) => row.townRef === input.townId)
    .sort((a, b) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
  return sorted[0]?.computedAt ?? null;
}

export async function listDueTownGraphTargets(limit = 20): Promise<Array<{ townId: string; userId?: string }>> {
  const max = Math.max(1, Math.min(100, limit));
  const candidates: Array<{ townId: string; userId?: string }> = [];
  const seen = new Set<string>();

  const pulseTargets = await listActiveTownPulseTargets(max * 3);
  for (const target of pulseTargets) {
    if (seen.has(target.townId)) continue;
    seen.add(target.townId);
    candidates.push(target);
  }

  if (getStorageMode() === "supabase" && candidates.length < max) {
    const extra = await listAdditionalSupabaseActiveTowns(max);
    for (const townId of extra) {
      if (seen.has(townId)) continue;
      seen.add(townId);
      candidates.push({ townId });
    }
  }

  const due: Array<{ townId: string; userId?: string }> = [];
  for (const candidate of candidates) {
    const latest = await latestSuggestionComputedAt({
      townId: candidate.townId,
      userId: candidate.userId,
    });
    if (!latest || isStale(latest, TOWN_GRAPH_STALE_HOURS)) {
      due.push(candidate);
    }
    if (due.length >= max) break;
  }
  return due;
}

async function upsertSuggestionRow(input: {
  townId: string;
  category: TownGraphCategory;
  suggestions: z.infer<typeof townGraphSuggestionRowSchema.shape.suggestions>;
  userId?: string;
}): Promise<void> {
  const computedAt = new Date().toISOString();
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { error } = await table("town_graph_suggestions").upsert(
      {
        town_ref: input.townId,
        category: input.category,
        suggestions: input.suggestions,
        computed_at: computedAt,
      },
      { onConflict: "town_ref,category" },
    );
    if (error) {
      throw error;
    }
    return;
  }
  if (!input.userId) {
    return;
  }
  const filePath = localSuggestionsPath(input.userId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, townGraphSuggestionRowSchema);
  const index = rows.findIndex((row) => row.townRef === input.townId && row.category === input.category);
  const next = townGraphSuggestionRowSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    townRef: input.townId,
    category: input.category,
    suggestions: input.suggestions,
    computedAt,
  });
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(filePath, rows.slice(-1500));
}

export async function recomputeTownGraphSuggestionsForTown(input: {
  townId: string;
  userId?: string;
}): Promise<{ updated: number }> {
  const graph = await getTownGraph({
    townId: input.townId,
    userId: input.userId,
  });
  let updated = 0;
  for (const category of CATEGORY_ORDER) {
    const edges = graph.edges
      .filter((edge) => edge.from === category)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((edge) => ({ to: edge.to, weight: edge.weight }));
    if (edges.length === 0) {
      continue;
    }
    const suggestions = fallbackSuggestionFromEdges({
      fromCategory: category,
      edges,
    });
    await upsertSuggestionRow({
      townId: input.townId,
      category,
      suggestions: {
        nextStopIdeas: suggestions.nextStopIdeas,
        collabSuggestion: suggestions.collabSuggestion,
      },
      userId: input.userId,
    });
    updated += 1;
  }
  return { updated };
}
