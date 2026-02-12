import type { RequestHandler } from "express";
import { resolveTenantByDomain } from "../services/tenantStore";

type CachedTenant = {
  tenant: Express.TenantContext | null;
  expiresAt: number;
};

const tenantCache = new Map<string, CachedTenant>();
const CACHE_MS = 60_000;

function normalizeHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(",")[0]?.trim().toLowerCase();
  if (!first) {
    return null;
  }
  return first.replace(/:\d+$/, "");
}

function shouldResolveHost(host: string): boolean {
  return host !== "localhost" && host !== "127.0.0.1";
}

export const tenantResolver: RequestHandler = async (req, _res, next) => {
  try {
    const queryHost =
      typeof req.query.tenantDomain === "string" ? req.query.tenantDomain.trim() : undefined;
    const host =
      normalizeHost(queryHost) ??
      normalizeHost(typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : undefined) ??
      normalizeHost(typeof req.headers.host === "string" ? req.headers.host : undefined);
    if (!host || !shouldResolveHost(host)) {
      req.tenant = undefined;
      return next();
    }

    const now = Date.now();
    const cached = tenantCache.get(host);
    if (cached && cached.expiresAt > now) {
      req.tenant = cached.tenant ?? undefined;
      return next();
    }

    const resolved = await resolveTenantByDomain(host);
    const tenant =
      resolved !== null
        ? {
            id: resolved.id,
            ownerId: resolved.ownerId,
            name: resolved.name,
            domain: resolved.domain,
            logoUrl: resolved.logoUrl,
            primaryColor: resolved.primaryColor,
            supportEmail: resolved.supportEmail,
            appName: resolved.appName,
            tagline: resolved.tagline,
            hideMainstreetaiBranding: resolved.hideMainstreetaiBranding,
          }
        : null;
    tenantCache.set(host, {
      tenant,
      expiresAt: now + CACHE_MS,
    });
    req.tenant = tenant ?? undefined;
    return next();
  } catch (error) {
    return next(error);
  }
};
