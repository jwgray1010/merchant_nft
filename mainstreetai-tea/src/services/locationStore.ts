import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  locationCreateSchema,
  locationSchema,
  locationUpdateSchema,
  type LocationCreate,
  type LocationRecord,
  type LocationUpdate,
} from "../schemas/locationSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

type BrandRow = {
  id: string;
  brand_id: string;
};

type LocationRow = {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  google_location_name: string | null;
  buffer_profile_id: string | null;
  created_at: string;
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

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
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

function userRoot(userId: string): string {
  return path.join(process.cwd(), "data", "local_mode", safePathSegment(userId));
}

function localLocationsDir(userId: string, brandId: string): string {
  return path.join(userRoot(userId), "locations", brandId);
}

function localLocationPath(userId: string, brandId: string, locationId: string): string {
  return path.join(localLocationsDir(userId, brandId), `${locationId}.json`);
}

function toLocationRecord(brandId: string, row: LocationRow): LocationRecord {
  return locationSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    name: row.name,
    address: row.address ?? undefined,
    timezone: row.timezone ?? "America/Chicago",
    googleLocationName: row.google_location_name ?? undefined,
    bufferProfileId: row.buffer_profile_id ?? undefined,
    createdAt: row.created_at,
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

export async function listLocations(userId: string, brandId: string): Promise<LocationRecord[]> {
  if (getStorageMode() === "local") {
    let entries: string[];
    try {
      entries = await readdir(localLocationsDir(userId, brandId));
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
          const raw = await readFile(path.join(localLocationsDir(userId, brandId), entry), "utf8");
          return locationSchema.safeParse(JSON.parse(raw));
        }),
    );
    return items
      .filter((item): item is { success: true; data: LocationRecord } => item.success)
      .map((item) => item.data)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return [];
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("locations")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .order("name", { ascending: true });
  if (error) {
    throw error;
  }
  return ((data ?? []) as LocationRow[]).map((row) => toLocationRecord(brandRef.brand_id, row));
}

export async function getLocationById(
  userId: string,
  brandId: string,
  locationId: string,
): Promise<LocationRecord | null> {
  if (getStorageMode() === "local") {
    const raw = await readJson<unknown>(localLocationPath(userId, brandId, locationId));
    if (!raw) {
      return null;
    }
    const parsed = locationSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return null;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("locations")
    .select("*")
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .eq("id", locationId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return toLocationRecord(brandRef.brand_id, data as LocationRow);
}

export async function addLocation(
  userId: string,
  brandId: string,
  input: LocationCreate,
): Promise<LocationRecord> {
  const parsed = locationCreateSchema.parse(input);
  if (getStorageMode() === "local") {
    const createdAt = new Date().toISOString();
    const record = locationSchema.parse({
      id: randomUUID(),
      ownerId: userId,
      brandId,
      name: parsed.name.trim(),
      address: parsed.address,
      timezone: parsed.timezone ?? "America/Chicago",
      googleLocationName: parsed.googleLocationName,
      bufferProfileId: parsed.bufferProfileId,
      createdAt,
    });
    await atomicWriteJson(localLocationPath(userId, brandId, record.id), record);
    return record;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("locations")
    .insert({
      owner_id: userId,
      brand_ref: brandRef.id,
      name: parsed.name.trim(),
      address: parsed.address ?? null,
      timezone: parsed.timezone ?? "America/Chicago",
      google_location_name: parsed.googleLocationName ?? null,
      buffer_profile_id: parsed.bufferProfileId ?? null,
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toLocationRecord(brandRef.brand_id, data as LocationRow);
}

export async function updateLocation(
  userId: string,
  brandId: string,
  locationId: string,
  updates: LocationUpdate,
): Promise<LocationRecord | null> {
  const parsed = locationUpdateSchema.parse(updates);
  if (getStorageMode() === "local") {
    const existing = await getLocationById(userId, brandId, locationId);
    if (!existing) {
      return null;
    }
    const next = locationSchema.parse({
      ...existing,
      ...parsed,
      name: parsed.name ?? existing.name,
      timezone: parsed.timezone ?? existing.timezone,
    });
    await atomicWriteJson(localLocationPath(userId, brandId, locationId), next);
    return next;
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return null;
  }
  const payload: Record<string, unknown> = {};
  if (parsed.name !== undefined) {
    payload.name = parsed.name.trim();
  }
  if (parsed.address !== undefined) {
    payload.address = parsed.address ?? null;
  }
  if (parsed.timezone !== undefined) {
    payload.timezone = parsed.timezone;
  }
  if (parsed.googleLocationName !== undefined) {
    payload.google_location_name = parsed.googleLocationName ?? null;
  }
  if (parsed.bufferProfileId !== undefined) {
    payload.buffer_profile_id = parsed.bufferProfileId ?? null;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("locations")
    .update(payload)
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .eq("id", locationId)
    .select("*")
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return toLocationRecord(brandRef.brand_id, data as LocationRow);
}

export async function deleteLocation(
  userId: string,
  brandId: string,
  locationId: string,
): Promise<boolean> {
  if (getStorageMode() === "local") {
    try {
      await rm(localLocationPath(userId, brandId, locationId));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  const brandRef = await resolveBrandRef(userId, brandId);
  if (!brandRef) {
    return false;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("locations")
    .delete()
    .eq("owner_id", userId)
    .eq("brand_ref", brandRef.id)
    .eq("id", locationId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw error;
  }
  return Boolean(data);
}
