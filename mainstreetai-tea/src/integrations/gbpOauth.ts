import { encrypt } from "../security/crypto";
import { createSignedState, verifySignedState } from "../security/stateToken";
import { getAdapter } from "../storage/getAdapter";

type GoogleBusinessOauthState = {
  userId: string;
  brandId: string;
  ts: number;
};

type GoogleBusinessLocation = {
  name: string;
  title?: string;
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

export function createGoogleBusinessOauthState(userId: string, brandId: string): string {
  return createSignedState({
    userId,
    brandId,
    ts: nowSeconds(),
  } satisfies GoogleBusinessOauthState);
}

export function verifyGoogleBusinessOauthState(
  stateToken: string,
  maxAgeSeconds = 900,
): GoogleBusinessOauthState {
  const parsed = verifySignedState<GoogleBusinessOauthState>(stateToken);
  if (!parsed.userId || !parsed.brandId || typeof parsed.ts !== "number") {
    throw new Error("Invalid Google OAuth state payload");
  }
  if (nowSeconds() - parsed.ts > maxAgeSeconds) {
    throw new Error("Google OAuth state token expired");
  }
  return parsed;
}

export function buildGoogleBusinessAuthorizeUrl(state: string): string {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requiredEnv("GOOGLE_REDIRECT_URI");
  const scopes =
    process.env.GOOGLE_OAUTH_SCOPES?.trim() ||
    "https://www.googleapis.com/auth/business.manage";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<Record<string, unknown>> {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requiredEnv("GOOGLE_REDIRECT_URI");

  const payload = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
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
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${rawText}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Google OAuth token response was invalid");
  }
  return parsed as Record<string, unknown>;
}

async function fetchGoogleBusinessLocations(accessToken: string): Promise<GoogleBusinessLocation[]> {
  const accountsResponse = await fetch(
    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const accountsText = await accountsResponse.text();
  let accountsParsed: unknown = accountsText;
  try {
    accountsParsed = JSON.parse(accountsText);
  } catch {
    // keep text fallback
  }

  if (!accountsResponse.ok) {
    throw new Error(
      `Google Business accounts fetch failed (${accountsResponse.status}): ${accountsText}`,
    );
  }

  const accounts = Array.isArray((accountsParsed as { accounts?: unknown[] })?.accounts)
    ? ((accountsParsed as { accounts?: unknown[] }).accounts as unknown[])
    : [];

  const locations: GoogleBusinessLocation[] = [];
  for (const account of accounts) {
    if (typeof account !== "object" || account === null) {
      continue;
    }
    const accountRecord = account as Record<string, unknown>;
    const accountName =
      typeof accountRecord.name === "string" ? accountRecord.name : "";
    if (!accountName) {
      continue;
    }

    const locationsResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${encodeURI(
        accountName,
      )}/locations?readMask=name,title&pageSize=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const locationsText = await locationsResponse.text();
    let locationsParsed: unknown = locationsText;
    try {
      locationsParsed = JSON.parse(locationsText);
    } catch {
      // keep fallback
    }

    if (!locationsResponse.ok) {
      continue;
    }

    const list = Array.isArray((locationsParsed as { locations?: unknown[] })?.locations)
      ? ((locationsParsed as { locations?: unknown[] }).locations as unknown[])
      : [];
    for (const location of list) {
      if (typeof location !== "object" || location === null) {
        continue;
      }
      const record = location as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!name) {
        continue;
      }
      const title = typeof record.title === "string" ? record.title : undefined;
      locations.push({
        name,
        title,
      });
    }
  }

  return locations;
}

export async function completeGoogleBusinessOauthAndSave(input: {
  code: string;
  stateToken: string;
}): Promise<{ userId: string; brandId: string }> {
  const state = verifyGoogleBusinessOauthState(input.stateToken);
  const tokenPayload = await exchangeCodeForToken(input.code);

  const accessToken = String(tokenPayload.access_token ?? "").trim();
  if (!accessToken) {
    throw new Error("Google OAuth token response missing access_token");
  }

  const refreshToken =
    typeof tokenPayload.refresh_token === "string" && tokenPayload.refresh_token.trim() !== ""
      ? tokenPayload.refresh_token
      : undefined;
  const expiresInSeconds =
    typeof tokenPayload.expires_in === "number" ? tokenPayload.expires_in : 3600;
  const expiryDate = Date.now() + Math.max(60, expiresInSeconds) * 1000;

  const locations = await fetchGoogleBusinessLocations(accessToken);
  if (locations.length === 0) {
    throw new Error(
      "Google OAuth succeeded but no Business Profile locations were found for this account",
    );
  }

  const adapter = getAdapter();
  await adapter.upsertIntegration(
    state.userId,
    state.brandId,
    "google_business",
    "connected",
    {
      locations,
      connectedAt: new Date().toISOString(),
    },
    encrypt(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry_date: expiryDate,
      }),
    ),
  );

  return {
    userId: state.userId,
    brandId: state.brandId,
  };
}
