import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import {
  autopublicityChannelsSchema,
  autopublicityJobRowSchema,
  autopublicityPackSchema,
  type AutopublicityChannels,
  type AutopublicityJobRow,
  type AutopublicityPack,
} from "../schemas/autopublicitySchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { getLocationById, type LocationRecord } from "./locationStore";
import { processDueOutbox } from "../jobs/outboxProcessor";
import { generateLocalTrustLine, isLocalTrustEnabled } from "./localTrustService";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseBrandRefRow = {
  id: string;
};

type SupabaseAutopublicityJobRow = {
  id: string;
  brand_ref: string;
  media_url: string;
  status: "draft" | "posting" | "posted";
  created_at: string;
};

type BufferProfile = {
  id: string;
  service: string;
};

type AutoPostChannel = "facebook" | "instagram" | "google" | "x";

type AutoPostStatus = "posted" | "queued" | "failed" | "skipped";

type AutoPostResult = {
  requested: boolean;
  status: AutoPostStatus;
  detail?: string;
  outboxId?: string;
};

type OpenReadyResult = {
  enabled: boolean;
  text: string;
  openUrl: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(ownerId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(ownerId));
}

function localAutopublicityJobsPath(ownerId: string): string {
  return path.join(localUserDir(ownerId), "autopublicity_jobs.json");
}

function localBrandRef(ownerId: string, brandId: string): string {
  return `${ownerId}:${brandId}`;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function readLocalArray<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const parsed = z.array(schema).safeParse(await readJsonOrNull<unknown>(filePath));
  if (parsed.success) {
    return parsed.data;
  }
  return [];
}

function parseBufferProfiles(config: unknown): BufferProfile[] {
  const rawProfiles =
    typeof config === "object" && config !== null && Array.isArray((config as { profiles?: unknown }).profiles)
      ? ((config as { profiles: unknown[] }).profiles ?? [])
      : [];
  return rawProfiles
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const service = typeof row.service === "string" ? row.service.trim().toLowerCase() : "";
      if (!id || !service) {
        return null;
      }
      return {
        id,
        service,
      };
    })
    .filter((entry): entry is BufferProfile => entry !== null);
}

function resolveBufferProfileId(input: {
  channel: "facebook" | "instagram" | "x";
  profiles: BufferProfile[];
  preferredProfileId?: string;
}): string | null {
  if (input.preferredProfileId) {
    const exact = input.profiles.find((profile) => profile.id === input.preferredProfileId);
    if (exact) {
      return exact.id;
    }
  }

  const matcher =
    input.channel === "facebook"
      ? (service: string) => service.includes("facebook")
      : input.channel === "instagram"
        ? (service: string) => service.includes("instagram")
        : (service: string) => service.includes("twitter") || service === "x" || service.includes("x.com");

  const matched = input.profiles.find((profile) => matcher(profile.service));
  if (matched) {
    return matched.id;
  }

  if (input.channel === "x") {
    return null;
  }
  return input.profiles[0]?.id ?? null;
}

function resolveGoogleLocationName(input: {
  config: unknown;
  location: LocationRecord | null;
}): string | undefined {
  const config =
    typeof input.config === "object" && input.config !== null
      ? (input.config as Record<string, unknown>)
      : {};
  const locations = Array.isArray(config.locations) ? config.locations : [];
  const firstLocation = locations.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).name === "string",
  ) as Record<string, unknown> | undefined;
  const fallbackLocationName =
    typeof config.locationName === "string" && config.locationName.trim() !== ""
      ? config.locationName.trim()
      : undefined;
  return (
    input.location?.googleLocationName ??
    (firstLocation ? String(firstLocation.name) : undefined) ??
    fallbackLocationName
  );
}

function fallbackAutopublicityPack(input: {
  captionIdea?: string;
  trustLine?: string;
}): AutopublicityPack {
  const base = input.captionIdea?.trim() || "Today on Main Street";
  const trustSuffix = input.trustLine ? ` ${input.trustLine}` : "";
  return autopublicityPackSchema.parse({
    masterCaption: `${base}. Quick local update from our team.${trustSuffix}`.trim(),
    facebookCaption: `${base}. Stop by and say hi today.${trustSuffix}`.trim(),
    instagramCaption: `${base}. Fresh local energy for today.${trustSuffix}`.trim(),
    twitterCaption: `${base}. Local update from us today.${trustSuffix}`.trim(),
    googleCaption: `${base}. Visit us today for a quick local stop.`,
    tiktokHook: "Quick local update: today's feature in 10 seconds.",
    snapchatText: "Local quick win today. Swing by if you are nearby.",
  });
}

function toAutopublicityJobRow(row: SupabaseAutopublicityJobRow): AutopublicityJobRow {
  return autopublicityJobRowSchema.parse({
    id: row.id,
    brandRef: row.brand_ref,
    mediaUrl: row.media_url,
    status: row.status,
    createdAt: row.created_at,
  });
}

async function resolveBrandContext(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ brandRef: string; brand: BrandProfile } | null> {
  const brand = await getAdapter().getBrand(input.ownerId, input.brandId);
  if (!brand) {
    return null;
  }
  if (getStorageMode() !== "supabase") {
    return {
      brandRef: localBrandRef(input.ownerId, input.brandId),
      brand,
    };
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("brand_id", input.brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const row = (data as SupabaseBrandRefRow | null) ?? null;
  if (!row?.id) {
    return null;
  }
  return {
    brandRef: row.id,
    brand,
  };
}

async function createAutopublicityJob(input: {
  ownerId: string;
  brandRef: string;
  mediaUrl: string;
}): Promise<AutopublicityJobRow> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("autopublicity_jobs")
      .insert({
        brand_ref: input.brandRef,
        media_url: input.mediaUrl,
        status: "draft",
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toAutopublicityJobRow(data as SupabaseAutopublicityJobRow);
  }

  const filePath = localAutopublicityJobsPath(input.ownerId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray(filePath, autopublicityJobRowSchema);
  const next = autopublicityJobRowSchema.parse({
    id: randomUUID(),
    brandRef: input.brandRef,
    mediaUrl: input.mediaUrl,
    status: "draft",
    createdAt: new Date().toISOString(),
  });
  existing.push(next);
  await atomicWriteJson(filePath, existing.slice(-4000));
  return next;
}

async function updateAutopublicityJobStatus(input: {
  ownerId: string;
  brandRef: string;
  jobId: string;
  status: "draft" | "posting" | "posted";
}): Promise<AutopublicityJobRow | null> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("autopublicity_jobs")
      .update({
        status: input.status,
      })
      .eq("id", input.jobId)
      .eq("brand_ref", input.brandRef)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toAutopublicityJobRow(data as SupabaseAutopublicityJobRow) : null;
  }

  const filePath = localAutopublicityJobsPath(input.ownerId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, autopublicityJobRowSchema);
  const index = rows.findIndex((row) => row.id === input.jobId && row.brandRef === input.brandRef);
  if (index < 0) {
    return null;
  }
  const next = autopublicityJobRowSchema.parse({
    ...rows[index],
    status: input.status,
  });
  rows[index] = next;
  await atomicWriteJson(filePath, rows.slice(-4000));
  return next;
}

function buildOpenReadyResults(input: {
  channels: AutopublicityChannels;
  pack: AutopublicityPack;
}): {
  tiktok?: OpenReadyResult;
  snapchat?: OpenReadyResult;
} {
  const results: {
    tiktok?: OpenReadyResult;
    snapchat?: OpenReadyResult;
  } = {};
  if (input.channels.tiktok) {
    results.tiktok = {
      enabled: true,
      text: input.pack.tiktokHook,
      openUrl: "https://www.tiktok.com/upload",
    };
  }
  if (input.channels.snapchat) {
    results.snapchat = {
      enabled: true,
      text: input.pack.snapchatText,
      openUrl: "https://www.snapchat.com/create",
    };
  }
  return results;
}

export async function runAutopublicity(input: {
  ownerId: string;
  brandId: string;
  mediaUrl: string;
  channels?: Partial<AutopublicityChannels>;
  confirmPost?: boolean;
  captionIdea?: string;
  locationId?: string;
}): Promise<{
  job: AutopublicityJobRow;
  pack: AutopublicityPack;
  autoPost: Record<AutoPostChannel, AutoPostResult>;
  openReady: {
    tiktok?: OpenReadyResult;
    snapchat?: OpenReadyResult;
  };
}> {
  const context = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const adapter = getAdapter();
  const channels = autopublicityChannelsSchema.parse(input.channels ?? {});
  const location =
    input.locationId && input.locationId.trim() !== ""
      ? await getLocationById(input.ownerId, input.brandId, input.locationId.trim())
      : null;
  if (input.locationId && !location) {
    throw new Error(`Location '${input.locationId}' was not found`);
  }

  const trustLine = isLocalTrustEnabled(context.brand)
    ? await generateLocalTrustLine({
        brand: context.brand,
        userId: input.ownerId,
        useCase: "daily_pack",
      }).catch(() => undefined)
    : undefined;

  const pack = await runPrompt({
    promptFile: "autopublicity.md",
    brandProfile: context.brand,
    userId: input.ownerId,
    locationContext: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          timezone: location.timezone,
        }
      : undefined,
    input: {
      brand: context.brand,
      mediaUrl: input.mediaUrl,
      captionIdea: input.captionIdea ?? null,
      channels,
      localTrustLine: trustLine ?? null,
    },
    imageUrls: [input.mediaUrl],
    outputSchema: autopublicityPackSchema,
  }).catch(() =>
    fallbackAutopublicityPack({
      captionIdea: input.captionIdea,
      trustLine,
    }),
  );

  const createdJob = await createAutopublicityJob({
    ownerId: input.ownerId,
    brandRef: context.brandRef,
    mediaUrl: input.mediaUrl,
  });

  const autoPost: Record<AutoPostChannel, AutoPostResult> = {
    facebook: {
      requested: channels.facebook,
      status: "skipped",
      detail: channels.facebook ? "Not posted yet." : "Not selected.",
    },
    instagram: {
      requested: channels.instagram,
      status: "skipped",
      detail: channels.instagram ? "Not posted yet." : "Not selected.",
    },
    google: {
      requested: channels.google,
      status: "skipped",
      detail: channels.google ? "Not posted yet." : "Not selected.",
    },
    x: {
      requested: channels.x,
      status: "skipped",
      detail: channels.x ? "Not posted yet." : "Not selected.",
    },
  };

  const openReady = buildOpenReadyResults({
    channels,
    pack,
  });

  if (!input.confirmPost) {
    await adapter.addHistory(
      input.ownerId,
      input.brandId,
      "publish",
      {
        mode: "autopublicity",
        confirmPost: false,
        mediaUrl: input.mediaUrl,
        channels,
      },
      {
        jobId: createdJob.id,
        jobStatus: createdJob.status,
        pack,
        openReady,
      },
    );
    return {
      job: createdJob,
      pack,
      autoPost,
      openReady,
    };
  }

  let job = (await updateAutopublicityJobStatus({
    ownerId: input.ownerId,
    brandRef: context.brandRef,
    jobId: createdJob.id,
    status: "posting",
  })) ?? createdJob;

  const [bufferIntegration, gbpIntegration] = await Promise.all([
    adapter.getIntegration(input.ownerId, input.brandId, "buffer"),
    adapter.getIntegration(input.ownerId, input.brandId, "google_business"),
  ]);

  const outboxByChannel: Partial<Record<AutoPostChannel, string>> = {};

  const queueSocialChannel = async (channel: "facebook" | "instagram" | "x", caption: string) => {
    if (!autoPost[channel].requested) {
      autoPost[channel] = {
        requested: false,
        status: "skipped",
        detail: "Not selected.",
      };
      return;
    }
    if (!bufferIntegration) {
      autoPost[channel] = {
        requested: true,
        status: "skipped",
        detail: "Buffer is not connected for this brand.",
      };
      return;
    }
    const profiles = parseBufferProfiles(bufferIntegration.config);
    const profileId = resolveBufferProfileId({
      channel,
      profiles,
      preferredProfileId: location?.bufferProfileId,
    });
    if (!profileId) {
      autoPost[channel] = {
        requested: true,
        status: "skipped",
        detail: channel === "x" ? "No X profile found in Buffer." : "No matching social profile found in Buffer.",
      };
      return;
    }

    const outbox = await adapter.enqueueOutbox(
      input.ownerId,
      input.brandId,
      "post_publish",
      {
        platform: channel === "x" ? "other" : channel,
        caption,
        mediaUrl: input.mediaUrl,
        source: "manual",
        notes: `AutoPublicity simple mode (${channel})`,
        bufferProfileId: profileId,
        locationId: location?.id,
        locationName: location?.name,
        autopublicityJobId: createdJob.id,
      },
      new Date().toISOString(),
    );
    outboxByChannel[channel] = outbox.id;
    autoPost[channel] = {
      requested: true,
      status: "queued",
      detail: "Queued for posting.",
      outboxId: outbox.id,
    };
  };

  await queueSocialChannel("facebook", pack.facebookCaption);
  await queueSocialChannel("instagram", pack.instagramCaption);
  await queueSocialChannel("x", pack.twitterCaption);

  if (!autoPost.google.requested) {
    autoPost.google = {
      requested: false,
      status: "skipped",
      detail: "Not selected.",
    };
  } else if (!gbpIntegration) {
    autoPost.google = {
      requested: true,
      status: "skipped",
      detail: "Google Business is not connected for this brand.",
    };
  } else {
    const locationName = resolveGoogleLocationName({
      config: gbpIntegration.config,
      location,
    });
    if (!locationName) {
      autoPost.google = {
        requested: true,
        status: "skipped",
        detail: "No Google Business location is configured.",
      };
    } else {
      const outbox = await adapter.enqueueOutbox(
        input.ownerId,
        input.brandId,
        "gbp_post",
        {
          locationName,
          summary: pack.googleCaption,
          mediaUrl: input.mediaUrl,
          locationId: location?.id,
          locationLabel: location?.name,
          autopublicityJobId: createdJob.id,
        },
        new Date().toISOString(),
      );
      outboxByChannel.google = outbox.id;
      autoPost.google = {
        requested: true,
        status: "queued",
        detail: "Queued for posting.",
        outboxId: outbox.id,
      };
    }
  }

  if (Object.keys(outboxByChannel).length > 0) {
    await processDueOutbox({
      limit: Math.max(12, Object.keys(outboxByChannel).length * 4),
      types: ["post_publish", "gbp_post"],
    }).catch(() => {
      // Outbox processor failures should not discard generated captions.
    });
  }

  for (const [channel, outboxId] of Object.entries(outboxByChannel) as Array<[AutoPostChannel, string]>) {
    const refreshed = await adapter.getOutboxById(input.ownerId, input.brandId, outboxId).catch(() => null);
    if (!refreshed) {
      continue;
    }
    if (refreshed.status === "sent") {
      autoPost[channel] = {
        ...autoPost[channel],
        status: "posted",
        detail: "Posted.",
      };
      continue;
    }
    if (refreshed.status === "failed") {
      autoPost[channel] = {
        ...autoPost[channel],
        status: "failed",
        detail: refreshed.lastError ?? "Post failed.",
      };
      continue;
    }
    autoPost[channel] = {
      ...autoPost[channel],
      status: "queued",
      detail: "Queued for retry.",
    };
  }

  job =
    (await updateAutopublicityJobStatus({
      ownerId: input.ownerId,
      brandRef: context.brandRef,
      jobId: createdJob.id,
      status: "posted",
    })) ?? job;

  await adapter.addHistory(
    input.ownerId,
    input.brandId,
    "publish",
    {
      mode: "autopublicity",
      confirmPost: true,
      mediaUrl: input.mediaUrl,
      captionIdea: input.captionIdea,
      channels,
      locationId: location?.id,
    },
    {
      jobId: job.id,
      jobStatus: job.status,
      pack,
      autoPost,
      openReady,
    },
  );

  return {
    job,
    pack,
    autoPost,
    openReady,
  };
}
