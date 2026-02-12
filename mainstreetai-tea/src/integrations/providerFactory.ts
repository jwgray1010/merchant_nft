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
import { refreshGoogleToken } from "./google/tokenRefresh";
import {
  buildGoogleBusinessAuthorizeUrl,
  completeGoogleBusinessOauthAndSave,
  createGoogleBusinessOauthState,
} from "./gbpOauth";
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

const gbpSecretEnvelopeSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expiry_date: z.number().int().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const gbpConfigSchema = z.object({
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        title: z.string().optional().default(""),
      }),
    )
    .default([]),
  connectedAt: z.string().datetime({ offset: true }).optional(),
  locationName: z.string().optional(),
  apiBaseUrl: z.string().optional(),
});

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

function normalizeGoogleSecretPayload(
  raw: z.infer<typeof gbpSecretEnvelopeSchema>,
): { access_token: string; refresh_token?: string; expiry_date?: number } {
  const accessToken =
    typeof raw.access_token === "string" && raw.access_token.trim() !== ""
      ? raw.access_token
      : typeof raw.accessToken === "string" && raw.accessToken.trim() !== ""
        ? raw.accessToken
        : "";
  const refreshToken =
    typeof raw.refresh_token === "string" && raw.refresh_token.trim() !== ""
      ? raw.refresh_token
      : typeof raw.refreshToken === "string" && raw.refreshToken.trim() !== ""
        ? raw.refreshToken
        : undefined;
  const expiryDate =
    typeof raw.expiry_date === "number" && Number.isFinite(raw.expiry_date)
      ? raw.expiry_date
      : typeof raw.expiresAt === "string"
        ? new Date(raw.expiresAt).getTime()
        : undefined;

  if (!accessToken) {
    throw new Error("Google Business integration token payload missing access token");
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: Number.isFinite(expiryDate ?? Number.NaN) ? expiryDate : undefined,
  };
}

export function createGoogleBusinessConnectUrl(
  userId: string,
  brandId: string,
  _locationName?: string,
): string {
  if (!isGoogleBusinessEnabled()) {
    throw new Error("Google Business integration is disabled. Set ENABLE_GBP_INTEGRATION=true");
  }
  const state = createGoogleBusinessOauthState(userId, brandId);
  return buildGoogleBusinessAuthorizeUrl(state);
}

export async function completeGoogleBusinessOauth(
  userId: string,
  stateToken: string,
  code: string,
) {
  if (!isGoogleBusinessEnabled()) {
    throw new Error("Google Business integration is disabled. Set ENABLE_GBP_INTEGRATION=true");
  }
  const result = await completeGoogleBusinessOauthAndSave({
    code,
    stateToken,
  });
  if (result.userId !== userId) {
    throw new Error("OAuth state user mismatch");
  }
  const adapter = getAdapter();
  const integration = await adapter.getIntegration(userId, result.brandId, "google_business");
  if (!integration) {
    throw new Error("Google Business integration was not persisted");
  }
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
  const rawSecrets = parseEncryptedJson(integration.secretsEnc, gbpSecretEnvelopeSchema);
  let secrets = normalizeGoogleSecretPayload(rawSecrets);

  if (secrets.expiry_date && secrets.expiry_date <= Date.now() + 15_000) {
    if (!secrets.refresh_token) {
      throw new Error("Google Business access token expired and no refresh token is available");
    }
    const refreshed = await refreshGoogleToken(secrets.refresh_token);
    secrets = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? secrets.refresh_token,
      expiry_date: refreshed.expiry_date,
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

  const defaultLocationName = config.locations[0]?.name ?? config.locationName;
  if (!defaultLocationName) {
    throw new Error(
      "Google Business integration has no connected locations. Reconnect and grant location access.",
    );
  }

  return new GoogleBusinessProvider({
    accessToken: secrets.access_token,
    defaultLocationName,
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
