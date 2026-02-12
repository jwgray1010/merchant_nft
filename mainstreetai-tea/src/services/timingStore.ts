import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  timingModelRecordSchema,
  type TimingModelData,
  type TimingModelRecord,
} from "../schemas/timingSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

type BrandRow = {
  id: string;
  brand_id: string;
};

type TimingRow = {
  id: string;
  owner_id: string;
  platform: string;
  model: unknown;
  computed_at: string;
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

function userRoot(userId: string): string {
  return path.join(process.cwd(), "data", "local_mode", safePathSegment(userId));
}

function localTimingDir(userId: string, brandId: string): string {
  return path.join(userRoot(userId), "post_timing_model", brandId);
}

function localTimingPath(userId: string, brandId: string, platform: string): string {
  return path.join(localTimingDir(userId, brandId), `${platform}.json`);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
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
  return (data as BrandRow | null) ?? null;
}

function toTimingModelRecord(brandId: string, row: TimingRow): TimingModelRecord {
  return timingModelRecordSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    platform: row.platform,
    model: row.model,
    computedAt: row.computed_at,
  });
}

export async function getTimingModel(
  userId: string,
  brandId: string,
  platform: string,
): Promise<TimingModelRecord | null> {
  if (getStorageMode() === "local") {
    const raw = await readJson<unknown>(localTimingPath(userId, brandId, platform));
    if (!raw) {
      return null;
    }
    const parsed = timingModelRecordSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return null;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("post_timing_model")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .eq("platform", platform)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return toTimingModelRecord(brandRef.brand_id, data as TimingRow);
}

export async function upsertTimingModel(
  userId: string,
  brandId: string,
  platform: string,
  model: TimingModelData,
): Promise<TimingModelRecord> {
  const computedAt = new Date().toISOString();
  if (getStorageMode() === "local") {
    const existing = await getTimingModel(userId, brandId, platform);
    const record = timingModelRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      ownerId: userId,
      brandId,
      platform,
      model,
      computedAt,
    });
    await atomicWriteJson(localTimingPath(userId, brandId, platform), record);
    return record;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("post_timing_model")
    .upsert(
      {
        owner_id: userId,
        brand_ref: brandRef.id,
        platform,
        model,
        computed_at: computedAt,
      },
      { onConflict: "owner_id,brand_ref,platform" },
    )
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toTimingModelRecord(brandRef.brand_id, data as TimingRow);
}

export async function listTimingModels(
  userId: string,
  brandId: string,
  limit: number,
): Promise<TimingModelRecord[]> {
  const safeLimit = Math.max(0, Math.min(limit, 20));
  if (getStorageMode() === "local") {
    let entries: string[];
    try {
      entries = await readdir(localTimingDir(userId, brandId));
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
    const rows = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(localTimingDir(userId, brandId), entry), "utf8");
          return timingModelRecordSchema.safeParse(JSON.parse(raw));
        }),
    );
    return rows
      .filter((row): row is { success: true; data: TimingModelRecord } => row.success)
      .map((row) => row.data)
      .sort((a, b) => b.computedAt.localeCompare(a.computedAt))
      .slice(0, safeLimit);
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return [];
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("post_timing_model")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .order("computed_at", { ascending: false })
    .limit(safeLimit);
  if (error) {
    throw error;
  }
  return ((data ?? []) as TimingRow[]).map((row) => toTimingModelRecord(brandRef.brand_id, row));
}
