import { encrypt } from "../security/crypto";
import { createSignedState, verifySignedState } from "../security/stateToken";
import { getAdapter } from "../storage/getAdapter";

type BufferOauthState = {
  userId: string;
  brandId: string;
  ts: number;
};

type BufferProfile = {
  id: string;
  service: string;
  username: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createBufferOauthState(userId: string, brandId: string): string {
  const state: BufferOauthState = {
    userId,
    brandId,
    ts: nowSeconds(),
  };
  return createSignedState(state);
}

export function verifyBufferOauthState(stateToken: string, maxAgeSeconds = 900): BufferOauthState {
  const parsed = verifySignedState<BufferOauthState>(stateToken);
  if (!parsed.userId || !parsed.brandId || typeof parsed.ts !== "number") {
    throw new Error("Invalid OAuth state payload");
  }

  if (nowSeconds() - parsed.ts > maxAgeSeconds) {
    throw new Error("OAuth state token expired");
  }
  return parsed;
}

export function buildBufferAuthorizeUrl(state: string): string {
  const clientId = requiredEnv("BUFFER_CLIENT_ID");
  const redirectUri = requiredEnv("BUFFER_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `https://buffer.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<Record<string, unknown>> {
  const clientId = requiredEnv("BUFFER_CLIENT_ID");
  const clientSecret = requiredEnv("BUFFER_CLIENT_SECRET");
  const redirectUri = requiredEnv("BUFFER_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://api.bufferapp.com/1/oauth2/token.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });

  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // keep raw fallback
  }

  if (!response.ok) {
    throw new Error(`Buffer token exchange failed (${response.status})`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Buffer token exchange returned invalid payload");
  }

  return parsed as Record<string, unknown>;
}

async function fetchBufferUser(accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://api.bufferapp.com/1/user.json?access_token=${encodeURIComponent(accessToken)}`,
  );

  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // keep raw fallback
  }

  if (!response.ok) {
    throw new Error(`Buffer user fetch failed (${response.status})`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Buffer user response was invalid");
  }

  return parsed as Record<string, unknown>;
}

async function fetchBufferProfiles(accessToken: string): Promise<BufferProfile[]> {
  const response = await fetch(
    `https://api.bufferapp.com/1/profiles.json?access_token=${encodeURIComponent(accessToken)}`,
  );

  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // keep raw fallback
  }

  if (!response.ok) {
    throw new Error(`Buffer profile fetch failed (${response.status})`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Buffer profiles response was invalid");
  }

  return parsed
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const service = typeof record.service === "string" ? record.service : "other";
      const username =
        typeof record.service_username === "string"
          ? record.service_username
          : typeof record.formatted_username === "string"
            ? record.formatted_username
            : "";

      if (!id) {
        return null;
      }
      return {
        id,
        service,
        username,
      } satisfies BufferProfile;
    })
    .filter((entry): entry is BufferProfile => entry !== null);
}

export async function completeBufferOauthAndSave(input: {
  code: string;
  stateToken: string;
}): Promise<{ userId: string; brandId: string }> {
  const state = verifyBufferOauthState(input.stateToken);
  const tokenPayload = await exchangeCodeForToken(input.code);

  const accessToken = String(tokenPayload.access_token ?? "").trim();
  if (!accessToken) {
    throw new Error("Buffer access_token missing in token response");
  }

  const refreshToken =
    typeof tokenPayload.refresh_token === "string" ? tokenPayload.refresh_token : undefined;
  const expiresInSeconds =
    typeof tokenPayload.expires_in === "number" ? tokenPayload.expires_in : undefined;
  const expiresAt =
    typeof expiresInSeconds === "number"
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : undefined;

  const [bufferUser, profiles] = await Promise.all([
    fetchBufferUser(accessToken),
    fetchBufferProfiles(accessToken),
  ]);

  const bufferUserId = String(bufferUser.id ?? "").trim();
  const orgId = typeof bufferUser.organization_id === "string" ? bufferUser.organization_id : undefined;
  const connectedAt = new Date().toISOString();

  const adapter = getAdapter();
  await adapter.upsertIntegration(
    state.userId,
    state.brandId,
    "buffer",
    "connected",
    {
      buffer_user_id: bufferUserId || undefined,
      org_id: orgId,
      connectedAt,
      profiles,
    },
    encrypt(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      }),
    ),
  );

  return {
    userId: state.userId,
    brandId: state.brandId,
  };
}
