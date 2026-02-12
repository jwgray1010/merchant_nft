import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  tenantResolvedSchema,
  tenantSettingsUpsertSchema,
  type TenantResolved,
  type TenantSettingsUpsert,
} from "../schemas/tenantSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

type TenantRow = {
  id: string;
  owner_id: string;
  name: string | null;
  domain: string | null;
  logo_url: string | null;
  primary_color: string | null;
  support_email: string | null;
  created_at: string;
};

type TenantBrandingRow = {
  id: string;
  tenant_ref: string;
  app_name: string | null;
  tagline: string | null;
  hide_mainstreetai_branding: boolean | null;
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

function localTenantPath(userId: string): string {
  return path.join(userRoot(userId), "tenant", "tenant.json");
}

function localBrandingPath(userId: string): string {
  return path.join(userRoot(userId), "tenant", "branding.json");
}

function toResolvedTenant(row: TenantRow, branding: TenantBrandingRow | null): TenantResolved {
  return tenantResolvedSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name ?? undefined,
    domain: row.domain ?? undefined,
    logoUrl: row.logo_url ?? undefined,
    primaryColor: row.primary_color ?? undefined,
    supportEmail: row.support_email ?? undefined,
    appName: branding?.app_name ?? "MainStreetAI",
    tagline: branding?.tagline ?? undefined,
    hideMainstreetaiBranding: Boolean(branding?.hide_mainstreetai_branding ?? false),
  });
}

async function getSupabaseTenantByOwner(ownerId: string): Promise<TenantRow | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("tenants")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as TenantRow | null) ?? null;
}

async function getSupabaseBranding(tenantId: string): Promise<TenantBrandingRow | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("tenant_branding")
    .select("*")
    .eq("tenant_ref", tenantId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as TenantBrandingRow | null) ?? null;
}

export async function getOwnerTenantSettings(ownerId: string): Promise<TenantResolved | null> {
  if (getStorageMode() === "local") {
    const tenant = await readJson<Record<string, unknown>>(localTenantPath(ownerId));
    if (!tenant) {
      return null;
    }
    const branding = await readJson<Record<string, unknown>>(localBrandingPath(ownerId));
    return tenantResolvedSchema.parse({
      id: String(tenant.id ?? ""),
      ownerId,
      name: typeof tenant.name === "string" ? tenant.name : undefined,
      domain: typeof tenant.domain === "string" ? tenant.domain : undefined,
      logoUrl: typeof tenant.logoUrl === "string" ? tenant.logoUrl : undefined,
      primaryColor: typeof tenant.primaryColor === "string" ? tenant.primaryColor : undefined,
      supportEmail: typeof tenant.supportEmail === "string" ? tenant.supportEmail : undefined,
      appName: typeof branding?.appName === "string" ? branding.appName : "MainStreetAI",
      tagline: typeof branding?.tagline === "string" ? branding.tagline : undefined,
      hideMainstreetaiBranding: Boolean(branding?.hideMainstreetaiBranding ?? false),
    });
  }

  const tenant = await getSupabaseTenantByOwner(ownerId);
  if (!tenant) {
    return null;
  }
  const branding = await getSupabaseBranding(tenant.id);
  return toResolvedTenant(tenant, branding);
}

export async function resolveTenantByDomain(hostname: string): Promise<TenantResolved | null> {
  const normalizedHost = hostname.trim().toLowerCase();
  if (!normalizedHost) {
    return null;
  }

  if (getStorageMode() === "local") {
    const root = path.join(process.cwd(), "data", "local_mode");
    let userDirs: Array<{ name: string; isDirectory(): boolean }>;
    try {
      userDirs = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }

    for (const dir of userDirs.filter((entry) => entry.isDirectory())) {
      const ownerId = dir.name;
      const tenant = await getOwnerTenantSettings(ownerId);
      if (!tenant?.domain) {
        continue;
      }
      if (tenant.domain.trim().toLowerCase() === normalizedHost) {
        return tenant;
      }
    }
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("tenants")
    .select("*")
    .eq("domain", normalizedHost)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  const tenant = data as TenantRow;
  const branding = await getSupabaseBranding(tenant.id);
  return toResolvedTenant(tenant, branding);
}

export async function upsertOwnerTenantSettings(
  ownerId: string,
  updates: TenantSettingsUpsert,
): Promise<TenantResolved> {
  const parsed = tenantSettingsUpsertSchema.parse(updates);

  if (getStorageMode() === "local") {
    const existing = await getOwnerTenantSettings(ownerId);
    const tenant = {
      id: existing?.id ?? randomUUID(),
      ownerId,
      name: parsed.name ?? existing?.name,
      domain: parsed.domain ?? existing?.domain,
      logoUrl: parsed.logoUrl ?? existing?.logoUrl,
      primaryColor: parsed.primaryColor ?? existing?.primaryColor,
      supportEmail: parsed.supportEmail ?? existing?.supportEmail,
      createdAt: new Date().toISOString(),
    };
    const branding = {
      appName: parsed.appName ?? existing?.appName ?? "MainStreetAI",
      tagline: parsed.tagline ?? existing?.tagline,
      hideMainstreetaiBranding:
        parsed.hideMainstreetaiBranding ?? existing?.hideMainstreetaiBranding ?? false,
    };
    await atomicWriteJson(localTenantPath(ownerId), tenant);
    await atomicWriteJson(localBrandingPath(ownerId), branding);
    return tenantResolvedSchema.parse({
      ...tenant,
      ...branding,
    });
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);

  const existingTenant = await getSupabaseTenantByOwner(ownerId);
  let tenantId = existingTenant?.id;
  let createdAt = existingTenant?.created_at ?? new Date().toISOString();

  if (existingTenant) {
    const { error } = await table("tenants")
      .update({
        name: parsed.name ?? existingTenant.name ?? null,
        domain: parsed.domain ?? existingTenant.domain ?? null,
        logo_url: parsed.logoUrl ?? existingTenant.logo_url ?? null,
        primary_color: parsed.primaryColor ?? existingTenant.primary_color ?? null,
        support_email: parsed.supportEmail ?? existingTenant.support_email ?? null,
      })
      .eq("id", existingTenant.id);
    if (error) {
      throw error;
    }
  } else {
    const { data, error } = await table("tenants")
      .insert({
        owner_id: ownerId,
        name: parsed.name ?? null,
        domain: parsed.domain ?? null,
        logo_url: parsed.logoUrl ?? null,
        primary_color: parsed.primaryColor ?? null,
        support_email: parsed.supportEmail ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    const row = data as TenantRow;
    tenantId = row.id;
    createdAt = row.created_at;
  }

  if (!tenantId) {
    throw new Error("Failed to resolve tenant id");
  }

  const existingBranding = await getSupabaseBranding(tenantId);
  const brandingPayload = {
    tenant_ref: tenantId,
    app_name: parsed.appName ?? existingBranding?.app_name ?? "MainStreetAI",
    tagline: parsed.tagline ?? existingBranding?.tagline ?? null,
    hide_mainstreetai_branding:
      parsed.hideMainstreetaiBranding ?? existingBranding?.hide_mainstreetai_branding ?? false,
  };
  const { error: brandingError } = await table("tenant_branding")
    .upsert(brandingPayload, { onConflict: "tenant_ref" });
  if (brandingError) {
    throw brandingError;
  }

  const updatedTenant = await getSupabaseTenantByOwner(ownerId);
  if (!updatedTenant) {
    throw new Error("Failed to read updated tenant settings");
  }
  const updatedBranding = await getSupabaseBranding(updatedTenant.id);
  return tenantResolvedSchema.parse({
    ...toResolvedTenant(updatedTenant, updatedBranding),
    createdAt,
  });
}
