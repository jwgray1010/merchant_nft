import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import { communityEventNeedSchema, communityEventSourceSchema, type CommunityEventNeed } from "../schemas/communityEventsSchema";
import {
  townBoardCleanOutputSchema,
  townBoardModerationSchema,
  townBoardPostSchema,
  townBoardSourceSchema,
  townBoardSubmissionSchema,
  type TownBoardPost,
  type TownBoardSource,
  type TownBoardStatus,
} from "../schemas/townBoardSchema";
import { townRecordSchema, type TownRecord } from "../schemas/townSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { importCommunityEvents } from "./communityEventsService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const TOWN_BOARD_FILE = path.join(LOCAL_ROOT, "town_board_posts.json");

type SupabaseTownRow = {
  id: string;
  name: string;
  region: string | null;
  timezone: string;
  created_at: string;
};

type SupabaseTownBoardPostRow = {
  id: string;
  town_ref: string;
  source: string;
  title: string;
  description: string | null;
  event_date: string;
  needs: unknown;
  contact_info: string;
  signup_url: string | null;
  status: string;
  created_at: string;
};

export type TownBoardPostWithTown = TownBoardPost & {
  townName: string;
  townRegion?: string;
  townSlug: string;
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

async function readLocalArray<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const parsed = z.array(schema).safeParse(await readJsonOrNull<unknown>(filePath));
  if (parsed.success) {
    return parsed.data;
  }
  return [];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function townSlugForRecord(town: { name: string; region?: string }): string {
  return slugify(town.region ? `${town.name}-${town.region}` : town.name);
}

function parseDateLike(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const directMs = Date.parse(normalized);
  if (Number.isFinite(directMs)) {
    return new Date(directMs).toISOString();
  }
  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    const [, year, month, day] = compactDate;
    return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
  }
  const compactDateTime = normalized.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (compactDateTime) {
    const [, year, month, day, hour, minute, second] = compactDateTime;
    const ms = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return null;
}

function normalizeSource(value: unknown): TownBoardSource {
  if (typeof value !== "string") {
    return "organizer";
  }
  const lower = value.trim().toLowerCase();
  if (lower === "community" || lower === "community_coordinator") {
    return "organizer";
  }
  const parsed = townBoardSourceSchema.safeParse(lower);
  return parsed.success ? parsed.data : "organizer";
}

function normalizeNeeds(value: unknown): CommunityEventNeed[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CommunityEventNeed[] = [];
  for (const entry of value) {
    const parsed = communityEventNeedSchema.safeParse(entry);
    if (parsed.success && !out.includes(parsed.data)) {
      out.push(parsed.data);
    }
  }
  return out;
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

function toTownBoardPost(row: SupabaseTownBoardPostRow): TownBoardPost {
  return townBoardPostSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    source: normalizeSource(row.source),
    title: row.title,
    description: row.description ?? "",
    eventDate: row.event_date,
    needs: normalizeNeeds(row.needs),
    contactInfo: row.contact_info,
    signupUrl: row.signup_url ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  });
}

async function listAllSupabaseTowns(limit = 2000): Promise<TownRecord[]> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("towns").select("*").order("name", { ascending: true }).limit(limit);
  if (error) {
    throw error;
  }
  return ((data ?? []) as SupabaseTownRow[]).map(toTownRecord);
}

async function listAllLocalTowns(): Promise<TownRecord[]> {
  const rows: TownRecord[] = [];
  const seen = new Set<string>();
  const entries = await readdir(LOCAL_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(LOCAL_ROOT, entry.name, "towns.json");
    const parsed = z.array(townRecordSchema).safeParse(await readJsonOrNull<unknown>(filePath));
    if (!parsed.success) {
      continue;
    }
    for (const town of parsed.data) {
      if (!seen.has(town.id)) {
        rows.push(town);
        seen.add(town.id);
      }
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function listAllTowns(): Promise<TownRecord[]> {
  if (getStorageMode() === "supabase") {
    return listAllSupabaseTowns();
  }
  return listAllLocalTowns();
}

export async function resolveTownBySlug(townSlug: string): Promise<TownRecord | null> {
  const normalizedSlug = slugify(townSlug);
  if (!normalizedSlug) {
    return null;
  }
  const towns = await listAllTowns();
  const direct = towns.find((town) => town.id === townSlug);
  if (direct) {
    return direct;
  }
  for (const town of towns) {
    const base = slugify(town.name);
    const withRegion = slugify(`${town.name}-${town.region ?? ""}`);
    if (normalizedSlug === base || normalizedSlug === withRegion) {
      return town;
    }
  }
  return null;
}

function syntheticTownBoardBrand(town: TownRecord): BrandProfile {
  return {
    brandId: slugify(`town-board-${town.id}`) || "town-board",
    businessName: `${town.name} Community Board`,
    location: town.region ? `${town.name}, ${town.region}` : town.name,
    townRef: town.id,
    supportLevel: "steady",
    localTrustEnabled: true,
    localTrustStyle: "mainstreet",
    serviceTags: [],
    type: "other",
    voice: "Warm, local, practical, and community-first.",
    audiences: ["neighbors", "families", "local organizers"],
    productsOrServices: ["community bulletin updates"],
    hours: "Varies",
    typicalRushTimes: "Varies",
    slowHours: "Varies",
    offersWeCanUse: [],
    constraints: {
      noHugeDiscounts: true,
      keepPromosSimple: true,
      avoidCorporateLanguage: true,
      avoidControversy: true,
    },
    communityVibeProfile: {
      localTone: "neighborly",
      collaborationLevel: "high",
      localIdentityTags: ["main-street", "community"],
      audienceStyle: "mixed",
      avoidCorporateTone: true,
    },
  };
}

async function cleanTownBoardCopy(input: {
  town: TownRecord;
  source: TownBoardSource;
  title: string;
  description: string;
  needs: CommunityEventNeed[];
}): Promise<{ title: string; description: string; communityLine: string } | null> {
  const model = await runPrompt({
    promptFile: "townboard_clean.md",
    brandProfile: syntheticTownBoardBrand(input.town),
    input: {
      town: {
        name: input.town.name,
        region: input.town.region,
      },
      source: input.source,
      title: input.title,
      description: input.description,
      needs: input.needs,
    },
    outputSchema: townBoardCleanOutputSchema,
  }).catch(() => null);
  if (!model) {
    return null;
  }
  return {
    title: normalizeWhitespace(model.title),
    description: normalizeWhitespace(model.description),
    communityLine: normalizeWhitespace(model.communityLine),
  };
}

function toPublishSource(source: TownBoardSource): z.infer<typeof communityEventSourceSchema> {
  if (source === "chamber" || source === "school" || source === "youth" || source === "nonprofit") {
    return source;
  }
  return "nonprofit";
}

function buildPublishDescription(post: TownBoardPost): string {
  const description = normalizeWhitespace(post.description);
  const contact = normalizeWhitespace(post.contactInfo);
  if (description && contact) {
    return `${description} | Contact: ${contact}`;
  }
  if (description) {
    return description;
  }
  if (contact) {
    return `Contact: ${contact}`;
  }
  return "Local community event invitation.";
}

async function publishTownBoardPost(post: TownBoardPost): Promise<void> {
  await importCommunityEvents({
    townId: post.townRef,
    source: toPublishSource(post.source),
    events: [
      {
        title: post.title,
        description: buildPublishDescription(post),
        eventDate: post.eventDate,
        needs: post.needs,
        signupUrl: post.signupUrl,
      },
    ],
    defaultSignupUrl: post.signupUrl,
  });
}

async function insertTownBoardPost(post: Omit<TownBoardPost, "id" | "createdAt">): Promise<TownBoardPost> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_board_posts")
      .insert({
        town_ref: post.townRef,
        source: post.source,
        title: post.title,
        description: post.description,
        event_date: post.eventDate,
        needs: post.needs,
        contact_info: post.contactInfo,
        signup_url: post.signupUrl ?? null,
        status: post.status,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownBoardPost(data as SupabaseTownBoardPostRow);
  }
  await ensureDir(path.dirname(TOWN_BOARD_FILE));
  const rows = await readLocalArray(TOWN_BOARD_FILE, townBoardPostSchema);
  const next = townBoardPostSchema.parse({
    id: randomUUID(),
    townRef: post.townRef,
    source: post.source,
    title: post.title,
    description: post.description,
    eventDate: post.eventDate,
    needs: post.needs,
    contactInfo: post.contactInfo,
    signupUrl: post.signupUrl,
    status: post.status,
    createdAt: new Date().toISOString(),
  });
  rows.push(next);
  await atomicWriteJson(
    TOWN_BOARD_FILE,
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10000),
  );
  return next;
}

async function getTownBoardPostById(postId: string): Promise<TownBoardPost | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_board_posts").select("*").eq("id", postId).maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toTownBoardPost(data as SupabaseTownBoardPostRow);
  }
  const rows = await readLocalArray(TOWN_BOARD_FILE, townBoardPostSchema);
  return rows.find((row) => row.id === postId) ?? null;
}

async function updateTownBoardPost(next: TownBoardPost): Promise<TownBoardPost> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("town_board_posts")
      .update({
        source: next.source,
        title: next.title,
        description: next.description,
        event_date: next.eventDate,
        needs: next.needs,
        contact_info: next.contactInfo,
        signup_url: next.signupUrl ?? null,
        status: next.status,
      })
      .eq("id", next.id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toTownBoardPost(data as SupabaseTownBoardPostRow);
  }
  await ensureDir(path.dirname(TOWN_BOARD_FILE));
  const rows = await readLocalArray(TOWN_BOARD_FILE, townBoardPostSchema);
  const index = rows.findIndex((row) => row.id === next.id);
  if (index < 0) {
    throw new Error(`Town board post '${next.id}' was not found`);
  }
  rows[index] = next;
  await atomicWriteJson(TOWN_BOARD_FILE, rows);
  return next;
}

async function resolveTownMap(townRefs: string[]): Promise<Map<string, TownRecord>> {
  const wanted = new Set(townRefs);
  const map = new Map<string, TownRecord>();
  if (wanted.size === 0) {
    return map;
  }
  const towns = await listAllTowns();
  for (const town of towns) {
    if (wanted.has(town.id)) {
      map.set(town.id, town);
    }
  }
  return map;
}

export async function submitTownBoardPostBySlug(input: {
  townSlug: string;
  source?: TownBoardSource;
  eventName: string;
  date: string;
  needs?: CommunityEventNeed[];
  description?: string;
  contactInfo: string;
  signupUrl?: string;
}): Promise<{ town: TownRecord; post: TownBoardPost }> {
  const town = await resolveTownBySlug(input.townSlug);
  if (!town) {
    throw new Error("Town board link is not active for this town yet.");
  }
  const parsed = townBoardSubmissionSchema.parse({
    source: input.source ?? "organizer",
    eventName: input.eventName,
    date: input.date,
    needs: input.needs ?? [],
    description: input.description,
    contactInfo: input.contactInfo,
    signupUrl: input.signupUrl,
  });
  const eventDate = parseDateLike(parsed.date);
  if (!eventDate) {
    throw new Error("Please add a clear date and time.");
  }
  const normalizedTitle = normalizeWhitespace(parsed.eventName).slice(0, 180);
  const normalizedDescription = normalizeWhitespace(parsed.description ?? "").slice(0, 800);
  const cleaned = await cleanTownBoardCopy({
    town,
    source: parsed.source,
    title: normalizedTitle,
    description: normalizedDescription,
    needs: parsed.needs,
  });
  const finalTitle = cleaned?.title ? cleaned.title.slice(0, 180) : normalizedTitle;
  const fallbackLine = "Our local community event could use support from neighborhood businesses.";
  const line = cleaned?.communityLine || fallbackLine;
  const baseDescription = cleaned?.description || normalizedDescription;
  const finalDescription =
    baseDescription && baseDescription.toLowerCase().includes(line.toLowerCase())
      ? baseDescription
      : normalizeWhitespace([baseDescription, line].filter(Boolean).join(" ")).slice(0, 900);
  const post = await insertTownBoardPost({
    townRef: town.id,
    source: parsed.source,
    title: finalTitle || normalizedTitle,
    description: finalDescription || line,
    eventDate,
    needs: parsed.needs,
    contactInfo: normalizeWhitespace(parsed.contactInfo).slice(0, 260),
    signupUrl: parsed.signupUrl,
    status: "pending",
  });
  return {
    town,
    post,
  };
}

export async function listTownBoardPosts(input: {
  status?: TownBoardStatus;
  townRef?: string;
  limit?: number;
}): Promise<TownBoardPost[]> {
  const max = Math.max(1, Math.min(300, input.limit ?? 120));
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    let query = table("town_board_posts").select("*").order("created_at", { ascending: false }).limit(max);
    if (input.status) {
      query = query.eq("status", input.status);
    }
    if (input.townRef) {
      query = query.eq("town_ref", input.townRef);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseTownBoardPostRow[]).map(toTownBoardPost);
  }
  const rows = await readLocalArray(TOWN_BOARD_FILE, townBoardPostSchema);
  return rows
    .filter((row) => (input.status ? row.status === input.status : true))
    .filter((row) => (input.townRef ? row.townRef === input.townRef : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

export async function listTownBoardPostsForModeration(input?: {
  status?: TownBoardStatus;
  limit?: number;
}): Promise<TownBoardPostWithTown[]> {
  const rows = await listTownBoardPosts({
    status: input?.status,
    limit: input?.limit ?? 160,
  });
  const townMap = await resolveTownMap(rows.map((row) => row.townRef));
  return rows.map((row) => {
    const town = townMap.get(row.townRef);
    return {
      ...row,
      townName: town?.name ?? "Unknown town",
      townRegion: town?.region,
      townSlug: town ? slugify(town.name) : "",
    };
  });
}

export async function moderateTownBoardPost(input: {
  postId: string;
  updates: {
    status?: TownBoardStatus;
    source?: TownBoardSource;
    title?: string;
    description?: string;
    date?: string;
    needs?: CommunityEventNeed[];
    contactInfo?: string;
    signupUrl?: string;
  };
}): Promise<TownBoardPost> {
  const post = await getTownBoardPostById(input.postId);
  if (!post) {
    throw new Error(`Town board post '${input.postId}' was not found`);
  }
  const parsed = townBoardModerationSchema.parse(input.updates);
  const nextDate = parsed.date ? parseDateLike(parsed.date) : post.eventDate;
  if (!nextDate) {
    throw new Error("Please provide a valid date for this post.");
  }
  const next = townBoardPostSchema.parse({
    ...post,
    status: parsed.status ?? post.status,
    source: parsed.source ?? post.source,
    title: parsed.title ? normalizeWhitespace(parsed.title).slice(0, 180) : post.title,
    description:
      parsed.description !== undefined
        ? normalizeWhitespace(parsed.description).slice(0, 900)
        : post.description,
    eventDate: nextDate,
    needs: parsed.needs ?? post.needs,
    contactInfo: parsed.contactInfo ? normalizeWhitespace(parsed.contactInfo).slice(0, 260) : post.contactInfo,
    signupUrl: parsed.signupUrl ?? post.signupUrl,
  });
  if (next.status === "approved") {
    await publishTownBoardPost(next);
  }
  return updateTownBoardPost(next);
}
