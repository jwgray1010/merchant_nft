import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import {
  communityEventFormSubmitSchema,
  communityEventNeedSchema,
  communityEventRowSchema,
  communityEventsImportRequestSchema,
  communityOpportunitySchema,
  eventInterestCreateRequestSchema,
  eventInterestRowSchema,
  eventInterestTypeSchema,
  eventResponseOutputSchema,
  type CommunityEventNeed,
  type CommunityEventRow,
  type CommunityEventSource,
  type CommunityOpportunity,
  type EventInterestType,
  type EventInterestRow,
} from "../schemas/communityEventsSchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");
const EVENTS_FILE = path.join(LOCAL_ROOT, "community_events.json");
const INTEREST_FILE = path.join(LOCAL_ROOT, "event_interest.json");

type SupabaseBrandRefRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  town_ref: string | null;
};

type SupabaseCommunityEventRow = {
  id: string;
  town_ref: string;
  source: string;
  title: string;
  description: string | null;
  event_date: string;
  needs: unknown;
  signup_url: string | null;
  created_at: string;
};

type SupabaseEventInterestRow = {
  id: string;
  brand_ref: string;
  event_ref: string;
  interest_type: string;
  created_at: string;
};

type ImportedCandidateEvent = {
  source: CommunityEventSource;
  title: string;
  description: string;
  eventDate: string;
  needs: CommunityEventNeed[];
  signupUrl?: string;
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

function localBrandRef(ownerId: string, brandId: string): string {
  return `${ownerId}:${brandId}`;
}

function toCommunityEventRow(row: SupabaseCommunityEventRow): CommunityEventRow {
  return communityEventRowSchema.parse({
    id: row.id,
    townRef: row.town_ref,
    source: normalizeSource(row.source),
    title: row.title,
    description: row.description ?? "",
    eventDate: row.event_date,
    needs: normalizeNeeds(row.needs),
    signupUrl: row.signup_url ?? undefined,
    createdAt: row.created_at,
  });
}

function toEventInterestRow(row: SupabaseEventInterestRow): EventInterestRow {
  return eventInterestRowSchema.parse({
    id: row.id,
    brandRef: row.brand_ref,
    eventRef: row.event_ref,
    interestType: normalizeInterestType(row.interest_type),
    createdAt: row.created_at,
  });
}

function normalizeSource(value: unknown): CommunityEventSource {
  const lower = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (lower === "chamber" || lower === "school" || lower === "youth" || lower === "nonprofit") {
    return lower;
  }
  if (lower === "community" || lower === "community_coordinator") {
    return "nonprofit";
  }
  return "chamber";
}

function normalizeInterestType(value: unknown): EventInterestType {
  const parsed = eventInterestTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "assist";
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  const compactDateTimeUtc = normalized.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (compactDateTimeUtc) {
    const [, year, month, day, hour, minute, second] = compactDateTimeUtc;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    ).toISOString();
  }
  const compactDateTime = normalized.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (compactDateTime) {
    const [, year, month, day, hour, minute, second] = compactDateTime;
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return null;
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsContent(icsRaw: string): Array<{ title: string; description: string; eventDate: string; signupUrl?: string }> {
  const unfolded = icsRaw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce<string[]>((rows, line) => {
      if ((line.startsWith(" ") || line.startsWith("\t")) && rows.length > 0) {
        rows[rows.length - 1] += line.slice(1);
      } else {
        rows.push(line);
      }
      return rows;
    }, []);

  const events: Array<{ title: string; description: string; eventDate: string; signupUrl?: string }> = [];
  let current: Record<string, string> | null = null;

  for (const line of unfolded) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) {
        const title = normalizeWhitespace(decodeIcsText(current.SUMMARY ?? ""));
        const description = normalizeWhitespace(decodeIcsText(current.DESCRIPTION ?? ""));
        const eventDate = parseDateLike(current.DTSTART ?? "");
        const signupUrl = normalizeWhitespace(current.URL ?? "");
        if (title && eventDate) {
          events.push({
            title,
            description,
            eventDate,
            signupUrl: signupUrl || undefined,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) {
      continue;
    }
    const splitAt = line.indexOf(":");
    if (splitAt < 0) {
      continue;
    }
    const rawKey = line.slice(0, splitAt).trim().toUpperCase();
    const value = line.slice(splitAt + 1).trim();
    const key = rawKey.split(";")[0];
    if (key === "SUMMARY" || key === "DESCRIPTION" || key === "URL") {
      current[key] = value;
      continue;
    }
    if (key === "DTSTART") {
      current.DTSTART = value;
    }
  }

  return events;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWebsiteTextToEvents(rawText: string): Array<{ title: string; description: string; eventDate: string }> {
  const text = stripHtml(rawText);
  if (!text) {
    return [];
  }
  const segments = text
    .split(/(?<=[\.\!\?])\s+|\n+/)
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length >= 12);
  const out: Array<{ title: string; description: string; eventDate: string }> = [];
  const datePatterns = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/i,
  ];
  for (const segment of segments) {
    if (!/\b(event|fundraiser|game|festival|youth|school|night|community)\b/i.test(segment)) {
      continue;
    }
    const dateToken = datePatterns.map((pattern) => segment.match(pattern)?.[0]).find(Boolean);
    if (!dateToken) {
      continue;
    }
    const eventDate = parseDateLike(dateToken);
    if (!eventDate) {
      continue;
    }
    const title = segment.slice(0, 110);
    out.push({
      title,
      description: segment,
      eventDate,
    });
  }
  return out;
}

function parseGoogleWebhookToEvents(payload: unknown): Array<{
  title: string;
  description: string;
  eventDate: string;
  signupUrl?: string;
}> {
  const out: Array<{ title: string; description: string; eventDate: string; signupUrl?: string }> = [];
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object" || current === null) {
      continue;
    }
    const row = current as Record<string, unknown>;
    if (Array.isArray(row.items)) {
      queue.push(...row.items);
    }
    if (Array.isArray(row.events)) {
      queue.push(...row.events);
    }
    const title =
      typeof row.summary === "string"
        ? row.summary
        : typeof row.title === "string"
          ? row.title
          : "";
    if (!title) {
      continue;
    }
    const description =
      typeof row.description === "string"
        ? row.description
        : typeof row.notes === "string"
          ? row.notes
          : "";
    const start = row.start;
    const startCandidate =
      typeof start === "string"
        ? start
        : typeof start === "object" && start !== null
          ? (start as Record<string, unknown>).dateTime ??
            (start as Record<string, unknown>).date ??
            (start as Record<string, unknown>).value
          : undefined;
    const eventDate = parseDateLike(String(startCandidate ?? row.eventDate ?? row.date ?? ""));
    if (!eventDate) {
      continue;
    }
    const signupUrl =
      typeof row.htmlLink === "string"
        ? row.htmlLink
        : typeof row.url === "string"
          ? row.url
          : undefined;
    out.push({
      title: normalizeWhitespace(title),
      description: normalizeWhitespace(description),
      eventDate,
      signupUrl: signupUrl?.trim() || undefined,
    });
  }
  return out;
}

function eventKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const keys: string[] = [];
  if (/\bfundraiser|fund-raiser|donation drive\b/.test(lower)) {
    keys.push("fundraiser");
  }
  if (/\bgame|match|playoff|tournament\b/.test(lower)) {
    keys.push("game");
  }
  if (/\bfestival|fair|parade\b/.test(lower)) {
    keys.push("festival");
  }
  if (/\byouth night|kids night|teen night|student night\b/.test(lower)) {
    keys.push("youth_night");
  }
  if (/\bschool\b/.test(lower)) {
    keys.push("school");
  }
  return keys;
}

function inferNeedsFromText(input: string): CommunityEventNeed[] {
  const lower = input.toLowerCase();
  const needs = new Set<CommunityEventNeed>();
  if (/\bcater|catering|meal|food table|food support\b/.test(lower)) {
    needs.add("catering");
  }
  if (/\bsponsor|sponsorship|donation|fundraiser|fund-raiser\b/.test(lower)) {
    needs.add("sponsorship");
  }
  if (/\bdrinks?|beverage|tea bar|coffee\b/.test(lower)) {
    needs.add("drinks");
  }
  if (/\bsnack|concession|treat\b/.test(lower)) {
    needs.add("drinks");
  }
  if (/\bvolunteer|helpers?|assist\b/.test(lower)) {
    needs.add("volunteers");
  }
  for (const keyword of eventKeywords(lower)) {
    if (keyword === "fundraiser") {
      needs.add("sponsorship");
    }
    if (keyword === "game") {
      needs.add("drinks");
    }
    if (keyword === "festival") {
      needs.add("volunteers");
    }
    if (keyword === "youth_night" || keyword === "school") {
      needs.add("volunteers");
      needs.add("drinks");
    }
  }
  return Array.from(needs);
}

function sanitizeImportedEvent(input: {
  source: CommunityEventSource;
  title: string;
  description?: string;
  eventDate: string;
  needs?: CommunityEventNeed[];
  signupUrl?: string;
}): ImportedCandidateEvent | null {
  const title = normalizeWhitespace(input.title).slice(0, 180);
  if (!title) {
    return null;
  }
  const eventDate = parseDateLike(input.eventDate);
  if (!eventDate) {
    return null;
  }
  const description = normalizeWhitespace(input.description ?? "");
  const inferredNeeds = inferNeedsFromText(`${title} ${description}`);
  const explicitNeeds = (input.needs ?? []).filter((entry): entry is CommunityEventNeed => {
    const parsed = communityEventNeedSchema.safeParse(entry);
    return parsed.success;
  });
  const needs = [...new Set([...explicitNeeds, ...inferredNeeds])];
  return {
    source: input.source,
    title,
    description,
    eventDate,
    needs,
    signupUrl: input.signupUrl?.trim() || undefined,
  };
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "MainStreetAI-CommunityBridge/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch '${url}' (status ${response.status})`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveBrandRefContext(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ brandRef: string; townRef: string | null; brand: BrandProfile } | null> {
  const brand = await getAdapter().getBrand(input.ownerId, input.brandId);
  if (!brand) {
    return null;
  }
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("brands")
      .select("id, owner_id, brand_id, town_ref")
      .eq("owner_id", input.ownerId)
      .eq("brand_id", input.brandId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const row = (data as SupabaseBrandRefRow | null) ?? null;
    if (!row) {
      return null;
    }
    return {
      brandRef: row.id,
      townRef: row.town_ref,
      brand,
    };
  }
  return {
    brandRef: localBrandRef(input.ownerId, input.brandId),
    townRef: brand.townRef ?? null,
    brand,
  };
}

async function listInterestsByBrandRef(brandRef: string): Promise<EventInterestRow[]> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("event_interest")
      .select("*")
      .eq("brand_ref", brandRef)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseEventInterestRow[]).map(toEventInterestRow);
  }
  const rows = await readLocalArray(INTEREST_FILE, eventInterestRowSchema);
  return rows
    .filter((row) => row.brandRef === brandRef)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listCommunityEventsForTown(input: {
  townId: string;
  fromIso?: string;
  limit?: number;
}): Promise<CommunityEventRow[]> {
  const max = Math.max(1, Math.min(400, input.limit ?? 120));
  const fromIso = parseDateLike(input.fromIso ?? "") ?? new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("community_events")
      .select("*")
      .eq("town_ref", input.townId)
      .gte("event_date", fromIso)
      .order("event_date", { ascending: true })
      .limit(max);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseCommunityEventRow[]).map(toCommunityEventRow);
  }
  const rows = await readLocalArray(EVENTS_FILE, communityEventRowSchema);
  return rows
    .filter((row) => row.townRef === input.townId && row.eventDate >= fromIso)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .slice(0, max);
}

async function upsertCommunityEventForTown(input: {
  townId: string;
  event: ImportedCandidateEvent;
}): Promise<CommunityEventRow> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data: existing, error: existingError } = await table("community_events")
      .select("*")
      .eq("town_ref", input.townId)
      .eq("title", input.event.title)
      .eq("event_date", input.event.eventDate)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }
    if (existing) {
      const { data, error } = await table("community_events")
        .update({
          source: input.event.source,
          description: input.event.description || "",
          needs: input.event.needs,
          signup_url: input.event.signupUrl ?? null,
        })
        .eq("id", (existing as { id: string }).id)
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return toCommunityEventRow(data as SupabaseCommunityEventRow);
    }
    const { data, error } = await table("community_events")
      .insert({
        town_ref: input.townId,
        source: input.event.source,
        title: input.event.title,
        description: input.event.description,
        event_date: input.event.eventDate,
        needs: input.event.needs,
        signup_url: input.event.signupUrl ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toCommunityEventRow(data as SupabaseCommunityEventRow);
  }
  await ensureDir(path.dirname(EVENTS_FILE));
  const rows = await readLocalArray(EVENTS_FILE, communityEventRowSchema);
  const existingIndex = rows.findIndex(
    (row) => row.townRef === input.townId && row.title === input.event.title && row.eventDate === input.event.eventDate,
  );
  const row = communityEventRowSchema.parse({
    id: existingIndex >= 0 ? rows[existingIndex].id : randomUUID(),
    townRef: input.townId,
    source: input.event.source,
    title: input.event.title,
    description: input.event.description,
    eventDate: input.event.eventDate,
    needs: input.event.needs,
    signupUrl: input.event.signupUrl,
    createdAt: existingIndex >= 0 ? rows[existingIndex].createdAt : new Date().toISOString(),
  });
  if (existingIndex >= 0) {
    rows[existingIndex] = row;
  } else {
    rows.push(row);
  }
  await atomicWriteJson(
    EVENTS_FILE,
    rows.sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(-6000),
  );
  return row;
}

function serviceTagsForBrand(brand: BrandProfile): string[] {
  const tags = new Set<string>((brand.serviceTags ?? []).map((entry) => entry.toLowerCase()));
  const type = brand.type.toLowerCase();
  if (tags.size === 0) {
    if (type === "cafe" || type === "restaurant" || type === "loaded-tea") {
      tags.add("drinks");
      tags.add("snacks");
      tags.add("catering");
    } else if (type === "fitness-hybrid") {
      tags.add("drinks");
      tags.add("snacks");
      tags.add("youth-support");
    } else if (type === "retail") {
      tags.add("fundraising");
    } else if (type === "service") {
      tags.add("fundraising");
      tags.add("youth-support");
    }
  }
  const searchable = `${brand.productsOrServices.join(" ")} ${brand.offersWeCanUse.join(" ")}`.toLowerCase();
  if (/\bcater|catering\b/.test(searchable)) tags.add("catering");
  if (/\bdrink|tea|coffee|beverage\b/.test(searchable)) tags.add("drinks");
  if (/\bsnack|treat|pastry|cookie\b/.test(searchable)) tags.add("snacks");
  if (/\bfundrais|sponsor|donation\b/.test(searchable)) tags.add("fundraising");
  if (/\byouth|school|student|kids|family\b/.test(searchable)) tags.add("youth-support");
  return Array.from(tags);
}

function matchScore(input: {
  event: CommunityEventRow;
  tags: string[];
}): number {
  let score = 0;
  const tagSet = new Set(input.tags);
  for (const need of input.event.needs) {
    if (need === "catering" && tagSet.has("catering")) score += 4;
    if (need === "drinks" && (tagSet.has("drinks") || tagSet.has("snacks"))) score += 3;
    if (need === "sponsorship" && tagSet.has("fundraising")) score += 3;
    if (need === "volunteers" && (tagSet.has("youth-support") || tagSet.has("fundraising"))) score += 2;
  }
  const text = `${input.event.title} ${input.event.description}`.toLowerCase();
  if (/\byouth|school|student|kids\b/.test(text) && tagSet.has("youth-support")) {
    score += 2;
  }
  if (/\bfundraiser|donation|benefit\b/.test(text) && tagSet.has("fundraising")) {
    score += 2;
  }
  if (score === 0 && input.event.needs.length === 0) {
    score = 1;
  }
  return score;
}

function formatNeedsLine(needs: CommunityEventNeed[]): string {
  if (needs.length === 0) {
    return "Looking for local support.";
  }
  const labels = needs.map((entry) => {
    if (entry === "catering") return "catering";
    if (entry === "sponsorship") return "sponsorship support";
    if (entry === "drinks") return "drinks & snacks";
    return "volunteers";
  });
  if (labels.length === 1) {
    return `Looking for ${labels[0]}.`;
  }
  if (labels.length === 2) {
    return `Looking for ${labels[0]} and ${labels[1]}.`;
  }
  return `Looking for ${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}.`;
}

function suggestedInterestTypeFor(input: {
  event: CommunityEventRow;
  tags: string[];
}): EventInterestType {
  const tagSet = new Set(input.tags);
  if (input.event.needs.includes("catering") && tagSet.has("catering")) {
    return "cater";
  }
  if (input.event.needs.includes("sponsorship") && tagSet.has("fundraising")) {
    return "sponsor";
  }
  if (input.event.needs.includes("drinks") && (tagSet.has("drinks") || tagSet.has("snacks"))) {
    return "cater";
  }
  return "assist";
}

async function resolveEventById(eventId: string): Promise<CommunityEventRow | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("community_events").select("*").eq("id", eventId).maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toCommunityEventRow(data as SupabaseCommunityEventRow);
  }
  const rows = await readLocalArray(EVENTS_FILE, communityEventRowSchema);
  return rows.find((row) => row.id === eventId) ?? null;
}

export async function generateEventResponseMessage(input: {
  ownerId: string;
  brandId: string;
  event: CommunityEventRow;
  interestType: EventInterestType;
  brand?: BrandProfile;
}): Promise<string> {
  const brand = input.brand ?? (await getAdapter().getBrand(input.ownerId, input.brandId));
  if (!brand) {
    return "Hi! We're part of the local network and would love to help with this event.";
  }
  const modelResult = await runPrompt({
    promptFile: "event_response.md",
    brandProfile: brand,
    userId: input.ownerId,
    input: {
      event: {
        title: input.event.title,
        description: input.event.description,
        eventDate: input.event.eventDate,
        needs: input.event.needs,
        source: input.event.source,
      },
      interestType: input.interestType,
    },
    outputSchema: eventResponseOutputSchema,
  }).catch(() => null);
  if (modelResult?.message) {
    return modelResult.message;
  }
  if (input.interestType === "sponsor") {
    return `Hi! We're part of the local network and would be glad to support ${input.event.title}.`;
  }
  if (input.interestType === "cater") {
    return `Hi! We're part of the local network and can help with drinks or snacks for ${input.event.title}.`;
  }
  return `Hi! We're part of the local network and would love to help with ${input.event.title}.`;
}

export async function buildCommunityOpportunityForBrand(input: {
  ownerId: string;
  brandId: string;
  brand?: BrandProfile;
}): Promise<CommunityOpportunity | null> {
  const context = await resolveBrandRefContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context?.townRef) {
    return null;
  }
  const brand = input.brand ?? context.brand;
  const [events, interests] = await Promise.all([
    listCommunityEventsForTown({
      townId: context.townRef,
      fromIso: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      limit: 80,
    }),
    listInterestsByBrandRef(context.brandRef),
  ]);
  const interestedSet = new Set(interests.map((row) => row.eventRef));
  const tags = serviceTagsForBrand(brand);
  const ranked = events
    .filter((event) => !interestedSet.has(event.id))
    .map((event) => ({
      event,
      score: matchScore({ event, tags }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.event.eventDate.localeCompare(b.event.eventDate);
    });
  const selected = ranked[0]?.event;
  if (!selected) {
    return null;
  }
  const interestType = suggestedInterestTypeFor({
    event: selected,
    tags,
  });
  const suggestedMessage = await generateEventResponseMessage({
    ownerId: input.ownerId,
    brandId: input.brandId,
    event: selected,
    interestType,
    brand,
  }).catch(() => undefined);
  return communityOpportunitySchema.parse({
    eventId: selected.id,
    source: selected.source,
    title: selected.title,
    description: selected.description,
    eventDate: selected.eventDate,
    needs: selected.needs,
    line: formatNeedsLine(selected.needs),
    suggestedInterestType: interestType,
    suggestedMessage,
    signupUrl: selected.signupUrl,
  });
}

export async function recordCommunityEventInterest(input: {
  ownerId: string;
  brandId: string;
  request: {
    eventId: string;
    interestType?: EventInterestType;
  };
}): Promise<{
  interest: EventInterestRow;
  event: CommunityEventRow;
}> {
  const parsed = eventInterestCreateRequestSchema.parse(input.request);
  const [context, event] = await Promise.all([
    resolveBrandRefContext({
      ownerId: input.ownerId,
      brandId: input.brandId,
    }),
    resolveEventById(parsed.eventId),
  ]);
  if (!context?.brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  if (!context.townRef) {
    throw new Error(`Brand '${input.brandId}' is not linked to a town`);
  }
  if (!event) {
    throw new Error(`Community event '${parsed.eventId}' was not found`);
  }
  if (event.townRef !== context.townRef) {
    throw new Error("Event is outside this brand's town network");
  }
  const interestType =
    parsed.interestType ??
    suggestedInterestTypeFor({
      event,
      tags: serviceTagsForBrand(context.brand),
    });
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("event_interest")
      .upsert(
        {
          brand_ref: context.brandRef,
          event_ref: event.id,
          interest_type: interestType,
        },
        { onConflict: "brand_ref,event_ref" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return {
      interest: toEventInterestRow(data as SupabaseEventInterestRow),
      event,
    };
  }
  await ensureDir(path.dirname(INTEREST_FILE));
  const rows = await readLocalArray(INTEREST_FILE, eventInterestRowSchema);
  const index = rows.findIndex(
    (row) => row.brandRef === context.brandRef && row.eventRef === event.id,
  );
  const next = eventInterestRowSchema.parse({
    id: index >= 0 ? rows[index].id : randomUUID(),
    brandRef: context.brandRef,
    eventRef: event.id,
    interestType,
    createdAt: index >= 0 ? rows[index].createdAt : new Date().toISOString(),
  });
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }
  await atomicWriteJson(INTEREST_FILE, rows.slice(-8000));
  return {
    interest: next,
    event,
  };
}

function parseImportedCandidatesFromManualList(input: {
  source: CommunityEventSource;
  events: Array<{ title: string; description?: string; eventDate: string; needs?: CommunityEventNeed[]; signupUrl?: string }>;
}): ImportedCandidateEvent[] {
  return input.events
    .map((entry) =>
      sanitizeImportedEvent({
        source: input.source,
        title: entry.title,
        description: entry.description,
        eventDate: entry.eventDate,
        needs: entry.needs,
        signupUrl: entry.signupUrl,
      }),
    )
    .filter((entry): entry is ImportedCandidateEvent => entry !== null);
}

export async function importCommunityEvents(input: {
  townId: string;
  source?: CommunityEventSource;
  icsUrl?: string;
  websiteUrl?: string;
  websiteText?: string;
  googleWebhook?: unknown;
  events?: Array<{ title: string; description?: string; eventDate: string; needs?: CommunityEventNeed[]; signupUrl?: string }>;
  defaultSignupUrl?: string;
}): Promise<{
  importedCount: number;
  skippedCount: number;
  events: CommunityEventRow[];
}> {
  const parsed = communityEventsImportRequestSchema.parse({
    townId: input.townId,
    source: input.source,
    icsUrl: input.icsUrl,
    websiteUrl: input.websiteUrl,
    websiteText: input.websiteText,
    googleWebhook: input.googleWebhook,
    events: input.events,
    defaultSignupUrl: input.defaultSignupUrl,
  });
  const source = parsed.source;
  const candidates: ImportedCandidateEvent[] = [];

  if (parsed.events && parsed.events.length > 0) {
    candidates.push(
      ...parseImportedCandidatesFromManualList({
        source,
        events: parsed.events,
      }),
    );
  }

  if (parsed.icsUrl) {
    const icsRaw = await fetchText(parsed.icsUrl);
    for (const row of parseIcsContent(icsRaw)) {
      const candidate = sanitizeImportedEvent({
        source,
        title: row.title,
        description: row.description,
        eventDate: row.eventDate,
        signupUrl: row.signupUrl ?? parsed.defaultSignupUrl,
      });
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  if (parsed.googleWebhook) {
    for (const row of parseGoogleWebhookToEvents(parsed.googleWebhook)) {
      const candidate = sanitizeImportedEvent({
        source,
        title: row.title,
        description: row.description,
        eventDate: row.eventDate,
        signupUrl: row.signupUrl ?? parsed.defaultSignupUrl,
      });
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  const websiteRaw = parsed.websiteText ?? (parsed.websiteUrl ? await fetchText(parsed.websiteUrl) : undefined);
  if (websiteRaw) {
    for (const row of parseWebsiteTextToEvents(websiteRaw)) {
      const candidate = sanitizeImportedEvent({
        source,
        title: row.title,
        description: row.description,
        eventDate: row.eventDate,
        signupUrl: parsed.defaultSignupUrl,
      });
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  const dedupedMap = new Map<string, ImportedCandidateEvent>();
  for (const event of candidates) {
    const key = `${parsed.townId}|${event.title.toLowerCase()}|${event.eventDate}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, event);
    }
  }
  const deduped = Array.from(dedupedMap.values())
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .slice(0, 250);

  const inserted: CommunityEventRow[] = [];
  for (const event of deduped) {
    const saved = await upsertCommunityEventForTown({
      townId: parsed.townId,
      event,
    });
    inserted.push(saved);
  }
  return {
    importedCount: inserted.length,
    skippedCount: Math.max(0, candidates.length - inserted.length),
    events: inserted,
  };
}

export async function submitCommunityEventForm(input: {
  townId: string;
  source?: CommunityEventSource;
  eventName: string;
  date: string;
  helpNeeded: string;
  contactInfo: string;
  description?: string;
  signupUrl?: string;
}): Promise<CommunityEventRow> {
  const parsed = communityEventFormSubmitSchema.parse({
    townId: input.townId,
    source: input.source,
    eventName: input.eventName,
    date: input.date,
    helpNeeded: input.helpNeeded,
    contactInfo: input.contactInfo,
    description: input.description,
    signupUrl: input.signupUrl,
  });
  const description = normalizeWhitespace(
    [parsed.description, `Help needed: ${parsed.helpNeeded}`, `Contact: ${parsed.contactInfo}`]
      .filter(Boolean)
      .join(" | "),
  );
  const candidate = sanitizeImportedEvent({
    source: parsed.source,
    title: parsed.eventName,
    description,
    eventDate: parsed.date,
    needs: inferNeedsFromText(parsed.helpNeeded),
    signupUrl: parsed.signupUrl,
  });
  if (!candidate) {
    throw new Error("Invalid event date. Please provide a clear date/time.");
  }
  return upsertCommunityEventForTown({
    townId: parsed.townId,
    event: candidate,
  });
}

export async function listCommunityOpportunitiesForBrand(input: {
  ownerId: string;
  brandId: string;
  limit?: number;
}): Promise<CommunityOpportunity[]> {
  const context = await resolveBrandRefContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context?.townRef) {
    return [];
  }
  const [events, interests] = await Promise.all([
    listCommunityEventsForTown({
      townId: context.townRef,
      fromIso: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      limit: 120,
    }),
    listInterestsByBrandRef(context.brandRef),
  ]);
  const interestedSet = new Set(interests.map((row) => row.eventRef));
  const tags = serviceTagsForBrand(context.brand);
  const max = Math.max(1, Math.min(25, input.limit ?? 5));
  const ranked = events
    .filter((event) => !interestedSet.has(event.id))
    .map((event) => ({ event, score: matchScore({ event, tags }) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.event.eventDate.localeCompare(b.event.eventDate);
    })
    .slice(0, max);
  return ranked.map((entry) =>
    communityOpportunitySchema.parse({
      eventId: entry.event.id,
      source: entry.event.source,
      title: entry.event.title,
      description: entry.event.description,
      eventDate: entry.event.eventDate,
      needs: entry.event.needs,
      line: formatNeedsLine(entry.event.needs),
      suggestedInterestType: suggestedInterestTypeFor({
        event: entry.event,
        tags,
      }),
      signupUrl: entry.event.signupUrl,
    }),
  );
}

export async function buildCommunityPresenceLineForBrand(input: {
  ownerId: string;
  brandId: string;
}): Promise<string | null> {
  const context = await resolveBrandRefContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context?.townRef) {
    return null;
  }
  const events = await listCommunityEventsForTown({
    townId: context.townRef,
    fromIso: new Date().toISOString(),
    limit: 12,
  }).catch(() => []);
  const next = events[0];
  if (!next) {
    return null;
  }
  const date = new Date(next.eventDate);
  const day = date.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const text = `${next.title} ${next.description}`.toLowerCase();
  if (next.source === "youth" || next.source === "school" || /\byouth|school|student|kids\b/.test(text)) {
    if (isWeekend) {
      return "We've got a busy weekend with youth events - let's show up together.";
    }
    return "We've got youth events coming up this week - let's show up together.";
  }
  if (/\bfundraiser|festival|game|community\b/.test(text)) {
    return isWeekend
      ? "We've got community events this weekend - let's show up together."
      : "We've got community events this week - let's show up together.";
  }
  return null;
}

