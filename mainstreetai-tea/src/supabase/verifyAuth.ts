import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import type { AuthUser } from "../types/auth";
import { getSupabaseAdminClient } from "./supabaseAdmin";

type SignedSessionPayload = {
  v: 1;
  t: "msai_session";
  uid: string;
  email: string | null;
  exp: number;
};

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

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch (_error) {
    return null;
  }
}

function authTokenSecret(): string {
  return (
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.INTEGRATION_SECRET_KEY?.trim() ||
    "mainstreetai-local-session-secret"
  );
}

function signSessionPayload(payloadSegment: string): string {
  return createHmac("sha256", authTokenSecret()).update(payloadSegment).digest("base64url");
}

export function createSignedSessionToken(input: {
  userId: string;
  email?: string | null;
  ttlSeconds?: number;
}): string {
  const ttlSeconds = Math.max(60, Math.min(60 * 60 * 24 * 90, input.ttlSeconds ?? 60 * 60 * 24 * 30));
  const payload: SignedSessionPayload = {
    v: 1,
    t: "msai_session",
    uid: input.userId,
    email: input.email ?? null,
    exp: Date.now() + ttlSeconds * 1000,
  };
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signature = signSessionPayload(payloadSegment);
  return `localv2:${payloadSegment}.${signature}`;
}

function signedSessionFromToken(token: string): { id: string; email: string | null } | null {
  if (!token.startsWith("localv2:")) {
    return null;
  }
  const raw = token.slice("localv2:".length);
  const separator = raw.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const payloadSegment = raw.slice(0, separator);
  const signatureSegment = raw.slice(separator + 1);
  if (!payloadSegment || !signatureSegment) {
    return null;
  }
  const expected = signSessionPayload(payloadSegment);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signatureSegment, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null;
  }
  const decoded = base64UrlDecode(payloadSegment);
  if (!decoded) {
    return null;
  }
  let parsed: SignedSessionPayload;
  try {
    parsed = JSON.parse(decoded) as SignedSessionPayload;
  } catch (_error) {
    return null;
  }
  if (
    parsed?.v !== 1 ||
    parsed?.t !== "msai_session" ||
    typeof parsed.uid !== "string" ||
    parsed.uid.trim() === "" ||
    typeof parsed.exp !== "number" ||
    !Number.isFinite(parsed.exp)
  ) {
    return null;
  }
  if (Date.now() > parsed.exp) {
    return null;
  }
  return {
    id: parsed.uid,
    email: typeof parsed.email === "string" ? parsed.email : null,
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
  const signedSession = signedSessionFromToken(token);
  if (signedSession) {
    if (isLocalMode()) {
      return signedSession;
    }
    try {
      const supabaseAdmin = getSupabaseAdminClient();
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(signedSession.id);
      if (error || !data.user) {
        return null;
      }
      return {
        id: data.user.id,
        email: data.user.email ?? signedSession.email ?? null,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }

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
