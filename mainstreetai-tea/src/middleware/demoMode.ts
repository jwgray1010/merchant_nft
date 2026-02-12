import type { RequestHandler } from "express";
import { FEATURES } from "../config/featureFlags";

function envDemoModeEnabled(): boolean {
  const raw = (process.env.DEMO_MODE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function queryDemoEnabled(raw: unknown): boolean {
  if (typeof raw !== "string") {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isBlockedWritePath(pathname: string): boolean {
  return (
    pathname.startsWith("/publish") ||
    pathname.startsWith("/api/publish") ||
    pathname.startsWith("/sms/send") ||
    pathname.startsWith("/api/sms/send") ||
    pathname.startsWith("/sms/campaign") ||
    pathname.startsWith("/api/sms/campaign") ||
    pathname.startsWith("/gbp/post") ||
    pathname.startsWith("/api/gbp/post") ||
    pathname.startsWith("/billing") ||
    pathname.startsWith("/api/billing")
  );
}

export const demoModeMiddleware: RequestHandler = (req, res, next) => {
  if (!FEATURES.demoMode) {
    return next();
  }
  const enabled = envDemoModeEnabled() || queryDemoEnabled(req.query.demo);
  if (!enabled) {
    return next();
  }

  const method = req.method.toUpperCase();
  const isWriteMethod =
    method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  if (!isWriteMethod) {
    return next();
  }

  const pathname = req.path;
  if (isBlockedWritePath(pathname)) {
    return res.status(403).json({
      error: "Write operations are disabled in demo mode",
      demoMode: true,
    });
  }
  return next();
};
