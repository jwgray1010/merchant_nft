import type { RequestHandler } from "express";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import type { TeamRole } from "../schemas/teamSchema";

export type BrandAccessContext = {
  ownerId: string;
  brandId: string;
  brandRef?: string;
  role: TeamRole;
};

function parseBrandIdFromQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function resolveBrandAccess(
  actorUserId: string,
  brandId: string,
): Promise<BrandAccessContext | null> {
  if (getStorageMode() === "local") {
    return {
      ownerId: actorUserId,
      brandId,
      role: "owner",
    };
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const ownerBrand = await table("brands")
    .select("id, owner_id, brand_id")
    .eq("owner_id", actorUserId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (ownerBrand.error) {
    throw ownerBrand.error;
  }
  const ownerRow = ownerBrand.data as Record<string, unknown> | null;
  if (ownerRow && typeof ownerRow.id === "string") {
    return {
      ownerId: String(ownerRow.owner_id ?? ""),
      brandRef: ownerRow.id,
      brandId: typeof ownerRow.brand_id === "string" ? ownerRow.brand_id : brandId,
      role: "owner",
    };
  }

  const memberRow = await table("team_members")
    .select("brand_ref, role, owner_id, brands!inner(id, owner_id, brand_id)")
    .eq("user_id", actorUserId)
    .eq("brands.brand_id", brandId)
    .maybeSingle();
  if (memberRow.error) {
    throw memberRow.error;
  }
  if (!memberRow.data) {
    return null;
  }

  const brands = (memberRow.data as { brands?: { id?: unknown; owner_id?: unknown; brand_id?: unknown } })
    .brands;
  const resolvedBrandId = typeof brands?.brand_id === "string" ? brands.brand_id : brandId;
  const resolvedOwnerId =
    typeof brands?.owner_id === "string"
      ? brands.owner_id
      : typeof (memberRow.data as { owner_id?: unknown }).owner_id === "string"
        ? String((memberRow.data as { owner_id: string }).owner_id)
        : "";
  if (!resolvedOwnerId) {
    return null;
  }

  const roleRaw = String((memberRow.data as { role?: unknown }).role ?? "member").trim().toLowerCase();
  const role: TeamRole =
    roleRaw === "owner" || roleRaw === "admin" || roleRaw === "member" ? roleRaw : "member";
  return {
    ownerId: resolvedOwnerId,
    brandId: resolvedBrandId,
    brandRef: typeof brands?.id === "string" ? brands.id : undefined,
    role,
  };
}

export function resolveBrandAccessFromQuery(options?: {
  queryKey?: string;
  required?: boolean;
}): RequestHandler {
  const queryKey = options?.queryKey ?? "brandId";
  const required = options?.required ?? true;

  return async (req, res, next) => {
    const actorUserId = req.user?.actorId ?? req.user?.id;
    if (!actorUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const brandId = parseBrandIdFromQuery(req.query[queryKey]);
    if (!brandId) {
      if (!required) {
        return next();
      }
      return res.status(400).json({ error: `Missing ${queryKey} query parameter` });
    }

    try {
      const access = await resolveBrandAccess(actorUserId, brandId);
      if (!access) {
        return res.status(404).json({ error: `Brand '${brandId}' was not found` });
      }

      req.brandAccess = access;
      req.user = {
        ...(req.user ?? { email: null }),
        id: access.ownerId,
        actorId: actorUserId,
        brandRole: access.role,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireBrandRole(allowedRoles: TeamRole[]): RequestHandler {
  return (req, res, next) => {
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    return next();
  };
}

export function actorUserIdFromRequest(req: Parameters<RequestHandler>[0]): string | null {
  const actor = req.user?.actorId ?? req.user?.id;
  return actor ?? null;
}
