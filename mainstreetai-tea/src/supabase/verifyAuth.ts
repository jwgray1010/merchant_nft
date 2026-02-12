import type { Request, RequestHandler } from "express";
import type { AuthUser } from "../types/auth";
import { getSupabaseAdminClient } from "./supabaseAdmin";

function parseBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function parseCookieToken(req: Request): string | null {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) {
    return null;
  }

  const parts = rawCookie.split(";").map((entry) => entry.trim());
  for (const part of parts) {
    const [name, ...rest] = part.split("=");
    if (name === "msai_token") {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function localUserFromToken(token: string): { id: string; email: string | null } | null {
  if (!token.startsWith("local:")) {
    return null;
  }

  const payload = token.slice("local:".length);
  if (!payload) {
    return null;
  }

  const [idRaw, emailRaw] = payload.split("|");
  const id = idRaw?.trim();
  if (!id) {
    return null;
  }
  return {
    id,
    email: emailRaw?.trim() || null,
  };
}

function isLocalMode(): boolean {
  return (process.env.STORAGE_MODE ?? "local").trim().toLowerCase() === "local";
}

export const verifyAuth: RequestHandler = async (req, res, next) => {
  const token = extractAuthToken(req);

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization bearer token" });
  }

  const user = await resolveAuthUser(token);
  if (!user) {
    if (isLocalMode()) {
      return res.status(401).json({
        error:
          "Invalid local auth token. Use format: Authorization: Bearer local:<userId>|<email>",
      });
    }
    return res.status(401).json({ error: "Invalid or expired auth token" });
  }

  req.user = user;
  return next();
};

export function extractAuthToken(req: Request): string | null {
  const headerToken = parseBearerToken(
    typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
  );
  return headerToken ?? parseCookieToken(req);
}

export async function resolveAuthUser(token: string): Promise<AuthUser | null> {
  if (isLocalMode()) {
    const localUser = localUserFromToken(token);
    return localUser;
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}
