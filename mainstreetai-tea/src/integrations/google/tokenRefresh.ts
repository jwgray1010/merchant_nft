function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export async function refreshGoogleToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
}> {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");

  const payload = new URLSearchParams();
  payload.set("client_id", clientId);
  payload.set("client_secret", clientSecret);
  payload.set("grant_type", "refresh_token");
  payload.set("refresh_token", refreshToken);

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
    // keep text fallback
  }

  if (!response.ok) {
    throw new Error(`Google token refresh failed (${response.status}): ${rawText}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Google token refresh response was invalid");
  }

  const record = parsed as Record<string, unknown>;
  const accessToken = String(record.access_token ?? "").trim();
  if (!accessToken) {
    throw new Error("Google token refresh did not include access_token");
  }

  const expiresIn = Number(record.expires_in ?? 3600);
  const expiryDate = Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000;
  const nextRefreshToken =
    typeof record.refresh_token === "string" && record.refresh_token.trim() !== ""
      ? record.refresh_token
      : undefined;

  return {
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    expiry_date: expiryDate,
  };
}
