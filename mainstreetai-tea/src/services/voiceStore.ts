import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  brandVoiceProfileSchema,
  brandVoiceProfileUpsertSchema,
  brandVoiceSampleCreateSchema,
  brandVoiceSampleSchema,
  type BrandVoiceProfile,
  type BrandVoiceProfileUpsert,
  type BrandVoiceSample,
  type BrandVoiceSampleCreate,
} from "../schemas/voiceSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

export const MAX_VOICE_SAMPLES_PER_BRAND = 200;

type BrandRow = {
  id: string;
  brand_id: string;
};

type VoiceSampleRow = {
  id: string;
  owner_id: string;
  source: string;
  content: string;
  created_at: string;
  brands?: { brand_id?: unknown } | null;
};

type VoiceProfileRow = {
  id: string;
  owner_id: string;
  embedding: unknown;
  style_summary: string | null;
  emoji_style: string | null;
  energy_level: string | null;
  phrases_to_repeat: unknown;
  do_not_use: unknown;
  updated_at: string;
  brands?: { brand_id?: unknown } | null;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function readJson<T>(filePath: string): Promise<T | null> {
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

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function userRoot(userId: string): string {
  return path.join(process.cwd(), "data", "local_mode", safePathSegment(userId));
}

function localSamplesDir(userId: string, brandId: string): string {
  return path.join(userRoot(userId), "voice_samples", brandId);
}

function localSamplePath(userId: string, brandId: string, id: string): string {
  return path.join(localSamplesDir(userId, brandId), `${id}.json`);
}

function localProfilePath(userId: string, brandId: string): string {
  return path.join(userRoot(userId), "voice_profile", `${brandId}.json`);
}

function toVoiceSample(brandId: string, row: VoiceSampleRow): BrandVoiceSample {
  return brandVoiceSampleSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    source: row.source,
    content: row.content,
    createdAt: row.created_at,
  });
}

function toVoiceProfile(brandId: string, row: VoiceProfileRow): BrandVoiceProfile {
  return brandVoiceProfileSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    embedding:
      typeof row.embedding === "object" && row.embedding !== null && !Array.isArray(row.embedding)
        ? row.embedding
        : undefined,
    styleSummary: row.style_summary ?? undefined,
    emojiStyle: row.emoji_style ?? undefined,
    energyLevel: row.energy_level ?? undefined,
    phrasesToRepeat: Array.isArray(row.phrases_to_repeat) ? row.phrases_to_repeat : [],
    doNotUse: Array.isArray(row.do_not_use) ? row.do_not_use : [],
    updatedAt: row.updated_at,
  });
}

async function resolveBrandRef(userId: string, brandId: string): Promise<BrandRow | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id, brand_id")
    .eq("owner_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return data as BrandRow;
}

async function trimSupabaseSamples(userId: string, brandRef: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brand_voice_samples")
    .select("id, created_at")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef)
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as Array<{ id?: unknown }>;
  if (rows.length <= MAX_VOICE_SAMPLES_PER_BRAND) {
    return;
  }
  const extraIds = rows
    .slice(MAX_VOICE_SAMPLES_PER_BRAND)
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((id): id is string => id !== null);
  if (extraIds.length === 0) {
    return;
  }
  const { error: deleteError } = await table("brand_voice_samples").delete().in("id", extraIds);
  if (deleteError) {
    throw deleteError;
  }
}

async function trimLocalSamples(userId: string, brandId: string): Promise<void> {
  const samples = await listBrandVoiceSamples(userId, brandId, 1000);
  if (samples.length <= MAX_VOICE_SAMPLES_PER_BRAND) {
    return;
  }
  const toDelete = samples.slice(MAX_VOICE_SAMPLES_PER_BRAND);
  await Promise.allSettled(
    toDelete.map((sample) => rm(localSamplePath(userId, brandId, sample.id), { force: true })),
  );
}

export async function listBrandVoiceSamples(
  userId: string,
  brandId: string,
  limit: number,
): Promise<BrandVoiceSample[]> {
  const safeLimit = Math.max(0, Math.min(limit, 1000));
  if (getStorageMode() === "local") {
    let entries: string[];
    try {
      entries = await readdir(localSamplesDir(userId, brandId));
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
    const items = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(localSamplesDir(userId, brandId), entry), "utf8");
          return brandVoiceSampleSchema.safeParse(JSON.parse(raw));
        }),
    );
    return items
      .filter((item): item is { success: true; data: BrandVoiceSample } => item.success)
      .map((item) => item.data)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit);
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return [];
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brand_voice_samples")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) {
    throw error;
  }
  return ((data ?? []) as VoiceSampleRow[]).map((row) => toVoiceSample(brandRef.brand_id, row));
}

export async function addBrandVoiceSample(
  userId: string,
  brandId: string,
  input: BrandVoiceSampleCreate,
): Promise<BrandVoiceSample> {
  const parsed = brandVoiceSampleCreateSchema.parse(input);
  if (getStorageMode() === "local") {
    const createdAt = new Date().toISOString();
    const record = brandVoiceSampleSchema.parse({
      id: randomUUID(),
      ownerId: userId,
      brandId,
      source: parsed.source,
      content: parsed.content.trim(),
      createdAt,
    });
    await atomicWriteJson(localSamplePath(userId, brandId, record.id), record);
    await trimLocalSamples(userId, brandId);
    return record;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brand_voice_samples")
    .insert({
      owner_id: userId,
      brand_ref: brandRef.id,
      source: parsed.source,
      content: parsed.content.trim(),
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  await trimSupabaseSamples(userId, brandRef.id);
  return toVoiceSample(brandRef.brand_id, data as VoiceSampleRow);
}

export async function getBrandVoiceProfile(
  userId: string,
  brandId: string,
): Promise<BrandVoiceProfile | null> {
  if (getStorageMode() === "local") {
    const raw = await readJson<unknown>(localProfilePath(userId, brandId));
    if (!raw) {
      return null;
    }
    const parsed = brandVoiceProfileSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brand_voice_profile")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return toVoiceProfile(brandRef.brand_id, data as VoiceProfileRow);
}

export async function upsertBrandVoiceProfile(
  userId: string,
  brandId: string,
  input: BrandVoiceProfileUpsert,
): Promise<BrandVoiceProfile> {
  const parsed = brandVoiceProfileUpsertSchema.parse(input);
  const nowIso = new Date().toISOString();

  if (getStorageMode() === "local") {
    const existing = await getBrandVoiceProfile(userId, brandId);
    const record = brandVoiceProfileSchema.parse({
      id: existing?.id ?? randomUUID(),
      ownerId: userId,
      brandId,
      embedding: parsed.embedding ?? existing?.embedding,
      styleSummary: parsed.styleSummary ?? existing?.styleSummary,
      emojiStyle: parsed.emojiStyle ?? existing?.emojiStyle,
      energyLevel: parsed.energyLevel ?? existing?.energyLevel,
      phrasesToRepeat: parsed.phrasesToRepeat ?? existing?.phrasesToRepeat ?? [],
      doNotUse: parsed.doNotUse ?? existing?.doNotUse ?? [],
      updatedAt: nowIso,
    });
    await atomicWriteJson(localProfilePath(userId, brandId), record);
    return record;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }
  const existing = await getBrandVoiceProfile(userId, brandId);
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);

  const payload = {
    owner_id: userId,
    brand_ref: brandRef.id,
    embedding: parsed.embedding ?? existing?.embedding ?? null,
    style_summary: parsed.styleSummary ?? existing?.styleSummary ?? null,
    emoji_style: parsed.emojiStyle ?? existing?.emojiStyle ?? null,
    energy_level: parsed.energyLevel ?? existing?.energyLevel ?? null,
    phrases_to_repeat: parsed.phrasesToRepeat ?? existing?.phrasesToRepeat ?? [],
    do_not_use: parsed.doNotUse ?? existing?.doNotUse ?? [],
    updated_at: nowIso,
  };

  const { data, error } = await table("brand_voice_profile")
    .upsert(payload, { onConflict: "owner_id,brand_ref" })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toVoiceProfile(brandRef.brand_id, data as VoiceProfileRow);
}
