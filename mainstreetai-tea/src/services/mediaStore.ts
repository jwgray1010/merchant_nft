import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  mediaAnalysisSchema,
  mediaAssetCreateSchema,
  mediaAssetSchema,
  mediaUploadUrlRequestSchema,
  mediaUploadUrlResponseSchema,
  type MediaAnalysis,
  type MediaAsset,
  type MediaAssetCreate,
  type MediaUploadUrlRequest,
} from "../schemas/mediaSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

type BrandRow = {
  id: string;
  brand_id: string;
};

type LocationRow = {
  id: string;
  brand_ref: string;
};

type MediaAssetRow = {
  id: string;
  owner_id: string;
  kind: string;
  source: string;
  url: string;
  width: number | null;
  height: number | null;
  location_ref: string | null;
  created_at: string;
  brands?: { brand_id?: unknown } | null;
};

type MediaAnalysisRow = {
  id: string;
  owner_id: string;
  asset_ref: string;
  platform: string;
  analysis: unknown;
  created_at: string;
  brands?: { brand_id?: unknown } | null;
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function userRoot(userId: string): string {
  return path.join(process.cwd(), "data", "local_mode", safePathSegment(userId));
}

function localAssetsDir(userId: string, brandId: string): string {
  return path.join(userRoot(userId), "media_assets", brandId);
}

function localAssetPath(userId: string, brandId: string, assetId: string): string {
  return path.join(localAssetsDir(userId, brandId), `${assetId}.json`);
}

function localAnalysisDir(userId: string, brandId: string): string {
  return path.join(userRoot(userId), "media_analysis", brandId);
}

function localAnalysisPath(userId: string, brandId: string, analysisId: string): string {
  return path.join(localAnalysisDir(userId, brandId), `${analysisId}.json`);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
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

async function resolveLocationRef(
  userId: string,
  brandRef: string,
  locationId: string,
): Promise<LocationRow | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("locations")
    .select("id, brand_ref")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef)
    .eq("id", locationId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as LocationRow | null) ?? null;
}

function toMediaAsset(brandId: string, row: MediaAssetRow): MediaAsset {
  return mediaAssetSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    locationId: row.location_ref ?? undefined,
    kind: row.kind,
    source: row.source,
    url: row.url,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    createdAt: row.created_at,
  });
}

function toMediaAnalysis(brandId: string, row: MediaAnalysisRow): MediaAnalysis {
  return mediaAnalysisSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    assetId: row.asset_ref,
    platform: row.platform,
    analysis: row.analysis,
    createdAt: row.created_at,
  });
}

function mediaBucket(): string {
  return (process.env.MEDIA_BUCKET ?? "media").trim() || "media";
}

function mediaPathForAsset(userId: string, brandId: string, assetId: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const safeExt = ext && ext.length <= 10 ? ext : ".bin";
  return `${safePathSegment(userId)}/${safePathSegment(brandId)}/${safePathSegment(assetId)}${safeExt}`;
}

export async function addMediaAsset(
  userId: string,
  brandId: string,
  input: MediaAssetCreate,
): Promise<MediaAsset> {
  const parsed = mediaAssetCreateSchema.parse(input);
  const createdAt = new Date().toISOString();

  if (getStorageMode() === "local") {
    const record = mediaAssetSchema.parse({
      id: randomUUID(),
      ownerId: userId,
      brandId,
      locationId: parsed.locationId,
      kind: parsed.kind,
      source: parsed.source,
      url: parsed.url,
      width: parsed.width,
      height: parsed.height,
      createdAt,
    });
    await atomicWriteJson(localAssetPath(userId, brandId, record.id), record);
    return record;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }
  let locationRef: string | null = null;
  if (parsed.locationId) {
    const location = await resolveLocationRef(userId, brandRef.id, parsed.locationId);
    if (!location) {
      throw new Error(`Location '${parsed.locationId}' was not found`);
    }
    locationRef = location.id;
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("media_assets")
    .insert({
      owner_id: userId,
      brand_ref: brandRef.id,
      location_ref: locationRef,
      kind: parsed.kind,
      source: parsed.source,
      url: parsed.url,
      width: parsed.width ?? null,
      height: parsed.height ?? null,
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toMediaAsset(brandRef.brand_id, data as MediaAssetRow);
}

export async function listMediaAssets(
  userId: string,
  brandId: string,
  limit: number,
): Promise<MediaAsset[]> {
  const safeLimit = Math.max(0, Math.min(limit, 200));
  if (getStorageMode() === "local") {
    let entries: string[];
    try {
      entries = await readdir(localAssetsDir(userId, brandId));
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
    const assets = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(localAssetsDir(userId, brandId), entry), "utf8");
          return mediaAssetSchema.safeParse(JSON.parse(raw));
        }),
    );
    return assets
      .filter((asset): asset is { success: true; data: MediaAsset } => asset.success)
      .map((asset) => asset.data)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit);
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return [];
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("media_assets")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) {
    throw error;
  }
  return ((data ?? []) as MediaAssetRow[]).map((row) => toMediaAsset(brandRef.brand_id, row));
}

export async function getMediaAssetById(
  userId: string,
  brandId: string,
  assetId: string,
): Promise<MediaAsset | null> {
  if (getStorageMode() === "local") {
    const raw = await readJson<unknown>(localAssetPath(userId, brandId, assetId));
    if (!raw) {
      return null;
    }
    const parsed = mediaAssetSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return null;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("media_assets")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .eq("id", assetId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return toMediaAsset(brandRef.brand_id, data as MediaAssetRow);
}

export async function addMediaAnalysis(
  userId: string,
  brandId: string,
  input: {
    assetId: string;
    platform: MediaAnalysis["platform"];
    analysis: MediaAnalysis["analysis"];
  },
): Promise<MediaAnalysis> {
  const createdAt = new Date().toISOString();
  if (getStorageMode() === "local") {
    const record = mediaAnalysisSchema.parse({
      id: randomUUID(),
      ownerId: userId,
      brandId,
      assetId: input.assetId,
      platform: input.platform,
      analysis: input.analysis,
      createdAt,
    });
    await atomicWriteJson(localAnalysisPath(userId, brandId, record.id), record);
    return record;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("media_analysis")
    .insert({
      owner_id: userId,
      brand_ref: brandRef.id,
      asset_ref: input.assetId,
      platform: input.platform,
      analysis: input.analysis,
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toMediaAnalysis(brandRef.brand_id, data as MediaAnalysisRow);
}

export async function listMediaAnalysis(
  userId: string,
  brandId: string,
  options?: { limit?: number; assetId?: string },
): Promise<MediaAnalysis[]> {
  const safeLimit = Math.max(0, Math.min(options?.limit ?? 50, 200));
  if (getStorageMode() === "local") {
    let entries: string[];
    try {
      entries = await readdir(localAnalysisDir(userId, brandId));
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
          const raw = await readFile(path.join(localAnalysisDir(userId, brandId), entry), "utf8");
          return mediaAnalysisSchema.safeParse(JSON.parse(raw));
        }),
    );
    return items
      .filter((item): item is { success: true; data: MediaAnalysis } => item.success)
      .map((item) => item.data)
      .filter((item) => (options?.assetId ? item.assetId === options.assetId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit);
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return [];
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  let query = table("media_analysis")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (options?.assetId) {
    query = query.eq("asset_ref", options.assetId);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return ((data ?? []) as MediaAnalysisRow[]).map((row) => toMediaAnalysis(brandRef.brand_id, row));
}

export async function createMediaUploadUrl(
  userId: string,
  brandId: string,
  input: MediaUploadUrlRequest,
): Promise<z.infer<typeof mediaUploadUrlResponseSchema>> {
  const parsed = mediaUploadUrlRequestSchema.parse(input);
  if (getStorageMode() === "local") {
    throw new Error("Signed upload URLs require STORAGE_MODE=supabase");
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }
  const assetId = randomUUID();
  const objectPath = mediaPathForAsset(userId, brandId, assetId, parsed.fileName);
  const supabase = getSupabaseAdminClient();
  const bucket = mediaBucket();
  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(objectPath);
  if (signedError || !signedData?.signedUrl) {
    throw signedError ?? new Error("Failed to create signed upload URL");
  }
  const publicUrl = supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  const kind =
    parsed.kind ??
    (parsed.contentType.startsWith("video/")
      ? "video"
      : parsed.contentType.startsWith("image/")
        ? "image"
        : "thumbnail");
  let locationRef: string | null = null;
  if (parsed.locationId) {
    const location = await resolveLocationRef(userId, brandRef.id, parsed.locationId);
    if (!location) {
      throw new Error(`Location '${parsed.locationId}' was not found`);
    }
    locationRef = location.id;
  }
  const table = (name: string): any => supabase.from(name as never);
  const { error: insertError } = await table("media_assets").insert({
    id: assetId,
    owner_id: userId,
    brand_ref: brandRef.id,
    location_ref: locationRef,
    kind,
    source: "upload",
    url: publicUrl,
    width: null,
    height: null,
  });
  if (insertError) {
    throw insertError;
  }
  return mediaUploadUrlResponseSchema.parse({
    signedUrl: signedData.signedUrl,
    publicUrl,
    assetId,
  });
}
