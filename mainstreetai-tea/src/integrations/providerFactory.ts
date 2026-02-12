import { z } from "zod";
import type {
  EmailProvider,
  GbpProvider,
  PublishPostInput,
  SchedulerProvider,
  SmsProvider,
} from "./Provider";
import { BufferProvider } from "./providers/buffer";
import { GoogleBusinessProvider } from "./providers/googleBusiness";
import { SendgridProvider } from "./providers/sendgrid";
import { TwilioProvider } from "./providers/twilio";
import { decrypt, encrypt } from "../security/crypto";
import { getAdapter } from "../storage/getAdapter";
import {
  isBufferEnabled,
  isEmailEnabled,
  isGoogleBusinessEnabled,
  isTwilioEnabled,
} from "./env";

const bufferSecretSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});

const bufferConfigSchema = z.object({
  buffer_user_id: z.string().optional(),
  org_id: z.string().optional(),
  connectedAt: z.string().datetime({ offset: true }).optional(),
  profiles: z
    .array(
      z.object({
        id: z.string().min(1),
        service: z.string().min(1),
        username: z.string().optional().default(""),
      }),
    )
    .optional(),
  channelIdByPlatform: z
    .object({
      facebook: z.string().optional(),
      instagram: z.string().optional(),
      tiktok: z.string().optional(),
      other: z.string().optional(),
    })
    .partial()
    .optional(),
  defaultChannelId: z.string().optional(),
  apiBaseUrl: z.string().optional(),
});

const gbpSecretSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const gbpConfigSchema = z.object({
  locationName: z.string().min(1),
  apiBaseUrl: z.string().optional(),
});

type GoogleOauthState = {
  userId: string;
  brandId: string;
  locationName: string;
  nonce: string;
  requestedAt: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseEncryptedJson<T>(payload: string | null | undefined, schema: z.ZodSchema<T>): T {
  if (!payload) {
    throw new Error("Missing encrypted integration secrets");
  }
  const decrypted = decrypt(payload);
  const parsed = JSON.parse(decrypted) as unknown;
  return schema.parse(parsed);
}

function normalizeBufferSecretPayload(raw: Record<string, unknown>) {
  const accessToken =
    typeof raw.access_token === "string"
      ? raw.access_token
      : typeof raw.accessToken === "string"
        ? raw.accessToken
        : "";
  const refreshToken =
    typeof raw.refresh_token === "string"
      ? raw.refresh_token
      : typeof raw.refreshToken === "string"
        ? raw.refreshToken
        : undefined;
  const expiresAt =
    typeof raw.expires_at === "string"
      ? raw.expires_at
      : typeof raw.expiresAt === "string"
        ? raw.expiresAt
        : undefined;

  return bufferSecretSchema.parse({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });
}

export async function connectBufferIntegration(
  userId: string,
  brandId: string,
  payload: {
    accessToken: string;
    channelIdByPlatform?: Partial<Record<"facebook" | "instagram" | "tiktok" | "other", string>>;
    defaultChannelId?: string;
    apiBaseUrl?: string;
  },
) {
  if (!isBufferEnabled()) {
    throw new Error("Buffer integration is disabled. Set ENABLE_BUFFER_INTEGRATION=true");
  }

  const adapter = getAdapter();
  const config = bufferConfigSchema.parse({
    connectedAt: new Date().toISOString(),
    channelIdByPlatform: payload.channelIdByPlatform,
    defaultChannelId: payload.defaultChannelId,
    apiBaseUrl: payload.apiBaseUrl,
  });
  const secret = bufferSecretSchema.parse({ access_token: payload.accessToken });
  const secretsEnc = encrypt(JSON.stringify(secret));

  return adapter.upsertIntegration(
    userId,
    brandId,
    "buffer",
    "connected",
    config as Record<string, unknown>,
    secretsEnc,
  );
}

export async function getBufferProvider(userId: string, brandId: string): Promise<SchedulerProvider> {
  if (!isBufferEnabled()) {
    throw new Error("Buffer integration is disabled. Set ENABLE_BUFFER_INTEGRATION=true");
  }

  const adapter = getAdapter();
  const integration = await adapter.getIntegration(userId, brandId, "buffer");
  if (!integration) {
    throw new Error("Buffer integration is not connected for this brand");
  }

  const config = bufferConfigSchema.parse(integration.config);
  const rawSecrets = parseEncryptedJson(integration.secretsEnc, z.record(z.string(), z.unknown()));
  const secrets = normalizeBufferSecretPayload(rawSecrets);
  const channelIdByPlatform: Partial<Record<"facebook" | "instagram" | "tiktok" | "other", string>> = {
    ...config.channelIdByPlatform,
  };

  for (const profile of config.profiles ?? []) {
    const service = profile.service.toLowerCase();
    if (service.includes("instagram") && !channelIdByPlatform.instagram) {
      channelIdByPlatform.instagram = profile.id;
    } else if (service.includes("facebook") && !channelIdByPlatform.facebook) {
      channelIdByPlatform.facebook = profile.id;
    } else if (service.includes("tiktok") && !channelIdByPlatform.tiktok) {
      channelIdByPlatform.tiktok = profile.id;
    } else if (!channelIdByPlatform.other) {
      channelIdByPlatform.other = profile.id;
    }
  }

  return new BufferProvider({
    accessToken: secrets.access_token,
    channelIdByPlatform,
    defaultChannelId: config.defaultChannelId,
    apiBaseUrl: config.apiBaseUrl,
  });
}

export async function publishWithBuffer(
  userId: string,
  brandId: string,
  input: PublishPostInput,
) {
  const provider = await getBufferProvider(userId, brandId);
  return provider.publishPost(input);
}

export async function getTwilioProvider(userId: string, brandId: string): Promise<SmsProvider> {
  if (!isTwilioEnabled()) {
    throw new Error("Twilio integration is disabled. Set ENABLE_TWILIO_INTEGRATION=true");
  }

  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
  const fromNumber = requiredEnv("TWILIO_FROM_NUMBER");

  const provider = new TwilioProvider({ accountSid, authToken, fromNumber });
  const adapter = getAdapter();
  await adapter.upsertIntegration(userId, brandId, "twilio", "connected", {
    fromNumber,
  });
  return provider;
}

export function createGoogleBusinessConnectUrl(
  userId: string,
  brandId: string,
  locationName: string,
): string {
  if (!isGoogleBusinessEnabled()) {
    throw new Error("Google Business integration is disabled. Set ENABLE_GBP_INTEGRATION=true");
  }

  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requiredEnv("GOOGLE_REDIRECT_URI");

  const statePayload: GoogleOauthState = {
    userId,
    brandId,
    locationName,
    nonce: Math.random().toString(36).slice(2),
    requestedAt: new Date().toISOString(),
  };
  const state = encodeURIComponent(encrypt(JSON.stringify(statePayload)));
  const scope = encodeURIComponent("https://www.googleapis.com/auth/business.manage");

  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");

  const payload = new URLSearchParams();
  payload.set("client_id", clientId);
  payload.set("client_secret", clientSecret);
  payload.set("grant_type", "refresh_token");
  payload.set("refresh_token", refreshToken);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // keep text
  }

  if (!response.ok) {
    throw new Error(`Google token refresh failed (${response.status}): ${rawText}`);
  }

  const record = parsed as Record<string, unknown>;
  return {
    accessToken: String(record.access_token ?? ""),
    expiresIn: Number(record.expires_in ?? 3600),
  };
}

export async function completeGoogleBusinessOauth(
  userId: string,
  stateToken: string,
  code: string,
) {
  if (!isGoogleBusinessEnabled()) {
    throw new Error("Google Business integration is disabled. Set ENABLE_GBP_INTEGRATION=true");
  }

  const redirectUri = requiredEnv("GOOGLE_REDIRECT_URI");
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");

  const stateJson = decrypt(decodeURIComponent(stateToken));
  const parsedState = JSON.parse(stateJson) as GoogleOauthState;
  if (parsedState.userId !== userId) {
    throw new Error("OAuth state user mismatch");
  }

  const tokenPayload = new URLSearchParams();
  tokenPayload.set("code", code);
  tokenPayload.set("client_id", clientId);
  tokenPayload.set("client_secret", clientSecret);
  tokenPayload.set("redirect_uri", redirectUri);
  tokenPayload.set("grant_type", "authorization_code");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenPayload,
  });
  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // keep text
  }

  if (!response.ok) {
    throw new Error(`Google OAuth exchange failed (${response.status}): ${rawText}`);
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const accessToken = String(parsedRecord.access_token ?? "");
  if (!accessToken) {
    throw new Error("Google OAuth response did not include access_token");
  }

  const refreshToken = String(parsedRecord.refresh_token ?? "");
  const expiresIn = Number(parsedRecord.expires_in ?? 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const adapter = getAdapter();
  const secretsEnc = encrypt(
    JSON.stringify({
      accessToken,
      refreshToken: refreshToken || undefined,
      expiresAt,
    }),
  );

  const integration = await adapter.upsertIntegration(
    userId,
    parsedState.brandId,
    "google_business",
    "connected",
    {
      locationName: parsedState.locationName,
    },
    secretsEnc,
  );

  return integration;
}

export async function getGoogleBusinessProvider(
  userId: string,
  brandId: string,
): Promise<GbpProvider> {
  if (!isGoogleBusinessEnabled()) {
    throw new Error("Google Business integration is disabled. Set ENABLE_GBP_INTEGRATION=true");
  }

  const adapter = getAdapter();
  const integration = await adapter.getIntegration(userId, brandId, "google_business");
  if (!integration) {
    throw new Error("Google Business integration is not connected for this brand");
  }

  const config = gbpConfigSchema.parse(integration.config);
  let secrets = parseEncryptedJson(integration.secretsEnc, gbpSecretSchema);

  if (secrets.expiresAt && new Date(secrets.expiresAt).getTime() <= Date.now() + 15_000) {
    if (!secrets.refreshToken) {
      throw new Error("Google Business access token expired and no refresh token is available");
    }
    const refreshed = await refreshGoogleAccessToken(secrets.refreshToken);
    secrets = {
      accessToken: refreshed.accessToken,
      refreshToken: secrets.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    };
    await adapter.upsertIntegration(
      userId,
      brandId,
      "google_business",
      "connected",
      integration.config,
      encrypt(JSON.stringify(secrets)),
    );
  }

  return new GoogleBusinessProvider({
    accessToken: secrets.accessToken,
    locationName: config.locationName,
    apiBaseUrl: config.apiBaseUrl,
  });
}

export async function getEmailProvider(userId: string, brandId: string): Promise<EmailProvider> {
  if (!isEmailEnabled()) {
    throw new Error("Email integration is disabled. Set ENABLE_EMAIL_INTEGRATION=true");
  }
  const apiKey = requiredEnv("SENDGRID_API_KEY");
  const fromEmail = requiredEnv("DIGEST_FROM_EMAIL");
  const replyToEmail = process.env.DIGEST_REPLY_TO_EMAIL?.trim() || undefined;

  const adapter = getAdapter();
  await adapter.upsertIntegration(userId, brandId, "sendgrid", "connected", {
    fromEmail,
    replyToEmail,
  });

  return new SendgridProvider({ apiKey, fromEmail, replyToEmail });
}
