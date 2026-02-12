import { runPrompt } from "../ai/runPrompt";
import { isEmailEnabled } from "../integrations/env";
import {
  dailyCheckinRequestSchema,
  dailyGoalSchema,
  localBoostOutputSchema,
  dailyOutputSchema,
  dailyPlatformSchema,
  dailyRequestSchema,
  type DailyCheckinRequest,
  type DailyGoal,
  type DailyOutput,
  type DailyPlatform,
  type DailyRequest,
} from "../schemas/dailyOneButtonSchema";
import {
  localCollabOutputSchema,
  localCollabRequestSchema,
  type LocalCollabOutput,
  type LocalCollabRequest,
} from "../schemas/localCollabSchema";
import { rescueOutputSchema, rescueRequestSchema, type RescueOutput, type RescueRequest } from "../schemas/rescueOneButtonSchema";
import { getAdapter } from "../storage/getAdapter";
import { getTimezoneParts, parsePostTimeToHourMinute, timezoneOrDefault, zonedDateTimeToUtcIso } from "../utils/timezone";
import { getUpcomingLocalEvents } from "./localEventAwareness";
import { getLocationById } from "./locationStore";
import { getOrRefreshInsightsCache } from "./autopilotService";
import { buildTownBoostForDaily } from "./townModeService";
import {
  buildTownPulsePromptSuggestion,
  getTownPulseModelForBrand,
  writeTownPulseSignalForBrand,
  writeTownPulseForDailyOutcome,
} from "./townPulseService";
import { getLatestTownStoryForBrand, recordTownStoryUsageForBrand } from "./townStoriesService";
import {
  addTownGraphEdge,
  buildTownGraphBoostForDaily,
  inferTownGraphCategoryFromText,
  townGraphCategoryFromBrandType,
} from "./townGraphService";
import { buildTownMicroRouteForDaily, buildTownSeasonalBoostForDaily } from "./townMicroRoutesService";
import { getBrandVoiceProfile } from "./voiceStore";
import { getOrRecomputeTimingModel } from "./timingModelService";
import type { TownMicroRouteWindow } from "../schemas/townGraphSchema";
import type { TownSeasonKey } from "../schemas/townSeasonSchema";

type DailyPackRecord = {
  id: string;
  createdAt: string;
  output: DailyOutput;
  response: unknown;
};

const SOCIAL_PLATFORMS: DailyPlatform[] = ["instagram", "facebook", "tiktok", "gbp", "other"];

type BufferProfile = { id: string; service: string };

function platformFromPost(input: { platform: string; providerMeta: unknown; notes: string | undefined }): DailyPlatform {
  if (input.platform === "instagram" || input.platform === "facebook" || input.platform === "tiktok") {
    return input.platform;
  }
  if (input.platform === "other") {
    const provider =
      typeof input.providerMeta === "object" && input.providerMeta !== null
        ? (input.providerMeta as Record<string, unknown>).provider
        : undefined;
    if (provider === "google_business" || /google business/i.test(input.notes ?? "")) {
      return "gbp";
    }
  }
  return "other";
}

function metricScore(metric: {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  redemptions?: number;
}): number {
  return (
    (metric.views ?? 0) / 100 +
    (metric.likes ?? 0) +
    (metric.comments ?? 0) * 2 +
    (metric.shares ?? 0) * 3 +
    (metric.saves ?? 0) * 2 +
    (metric.clicks ?? 0) * 2 +
    (metric.redemptions ?? 0) * 4
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function preferredPlatformFromSettings(channels: string[] | undefined): DailyPlatform | null {
  const first = (channels ?? []).find((channel) =>
    channel === "instagram" ||
    channel === "facebook" ||
    channel === "tiktok" ||
    channel === "google_business" ||
    channel === "other",
  );
  if (!first) {
    return null;
  }
  if (first === "google_business") {
    return "gbp";
  }
  return first as DailyPlatform;
}

function resolveBufferProfileId(input: {
  platform: "facebook" | "instagram" | "tiktok" | "other";
  profileId?: string;
  profiles: BufferProfile[];
}): string | null {
  if (input.profileId) {
    const found = input.profiles.find((profile) => profile.id === input.profileId);
    if (found) {
      return found.id;
    }
  }
  const needle =
    input.platform === "facebook"
      ? "facebook"
      : input.platform === "instagram"
        ? "instagram"
        : input.platform === "tiktok"
          ? "tiktok"
          : "";
  if (needle) {
    const found = input.profiles.find((profile) => profile.service.toLowerCase().includes(needle));
    if (found) {
      return found.id;
    }
  }
  return input.profiles[0]?.id ?? null;
}

function socialPublishPlatform(platform: DailyPlatform): "facebook" | "instagram" | "tiktok" | "other" {
  if (platform === "facebook" || platform === "instagram" || platform === "tiktok") {
    return platform;
  }
  return "other";
}

function sanitizeGoal(goal: string | undefined): DailyGoal {
  const parsed = dailyGoalSchema.safeParse(goal);
  return parsed.success ? parsed.data : "repeat_customers";
}

function sanitizeDailyPlatform(platform: string | undefined): DailyPlatform {
  const parsed = dailyPlatformSchema.safeParse(platform);
  return parsed.success ? parsed.data : "instagram";
}

function defaultGoalFromClock(timezone: string): DailyGoal {
  const parts = getTimezoneParts(new Date(), timezone);
  const day = parts.weekdayShort;
  if (day.startsWith("sat") || day.startsWith("sun")) {
    return "new_customers";
  }
  if (parts.hour >= 10 && parts.hour <= 16) {
    return "slow_hours";
  }
  return "repeat_customers";
}

function todayDateInTimezone(timezone: string): string {
  const parts = getTimezoneParts(new Date(), timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function scheduleIsoForBestTime(input: {
  timezone: string;
  bestTime: string;
  fallbackHour: number;
}): string {
  const parsed = parsePostTimeToHourMinute(input.bestTime);
  const hour = parsed?.hour ?? input.fallbackHour;
  const minute = parsed?.minute ?? 0;
  const iso = zonedDateTimeToUtcIso({
    date: todayDateInTimezone(input.timezone),
    hour,
    minute,
    timeZone: input.timezone,
  });
  const targetMs = new Date(iso).getTime();
  if (!Number.isFinite(targetMs) || targetMs < Date.now() + 2 * 60 * 1000) {
    return new Date(Date.now() + 2 * 60 * 1000).toISOString();
  }
  return iso;
}

function notesForOutcome(outcome: "slow" | "okay" | "busy"): string {
  if (outcome === "slow") return "Daily check-in: slow traffic today";
  if (outcome === "busy") return "Daily check-in: busy day with strong interest";
  return "Daily check-in: okay day with normal traffic";
}

async function selectPlatform(input: {
  userId: string;
  brandId: string;
  preferred: DailyPlatform | null;
}): Promise<DailyPlatform> {
  const adapter = getAdapter();
  const [posts, metrics] = await Promise.all([
    adapter.listPosts(input.userId, input.brandId, 400),
    adapter.listMetrics(input.userId, input.brandId, 600),
  ]);
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const metricByPostId = new Map<string, number[]>();
  for (const metric of metrics) {
    if (!metric.postId) continue;
    const createdMs = new Date(metric.createdAt).getTime();
    if (!Number.isFinite(createdMs) || createdMs < cutoffMs) continue;
    const current = metricByPostId.get(metric.postId) ?? [];
    current.push(metricScore(metric));
    metricByPostId.set(metric.postId, current);
  }

  const platformScores = new Map<DailyPlatform, number[]>();
  for (const post of posts) {
    const postedMs = new Date(post.postedAt).getTime();
    if (!Number.isFinite(postedMs) || postedMs < cutoffMs) continue;
    const platform = platformFromPost({
      platform: post.platform,
      providerMeta: post.providerMeta,
      notes: post.notes,
    });
    const score = average(metricByPostId.get(post.id) ?? [0.8]);
    const existing = platformScores.get(platform) ?? [];
    existing.push(score);
    platformScores.set(platform, existing);
  }

  const ranked = SOCIAL_PLATFORMS.map((platform) => {
    let score = average(platformScores.get(platform) ?? []);
    if (input.preferred === platform) {
      score += 0.15;
    }
    return { platform, score };
  }).sort((a, b) => b.score - a.score);

  if (ranked[0] && ranked[0].score > 0) {
    return ranked[0].platform;
  }
  if (input.preferred) {
    return input.preferred;
  }
  return "instagram";
}

function latestEmail(input: {
  notifyEmail?: string;
  ownerEmail?: string | null;
}): string | null {
  const configured = input.notifyEmail?.trim();
  if (configured) {
    return configured;
  }
  const owner = input.ownerEmail?.trim();
  return owner || null;
}

function recentPostSnapshots(posts: Array<{ platform: string; postedAt: string; captionUsed: string; promoName?: string }>) {
  return posts.slice(0, 12).map((post) => ({
    platform: post.platform,
    postedAt: post.postedAt,
    caption: post.captionUsed.slice(0, 220),
    promoName: post.promoName ?? null,
  }));
}

export async function runDailyOneButton(input: {
  userId: string;
  brandId: string;
  ownerEmail?: string | null;
  locationId?: string;
  request?: DailyRequest;
  windowOverride?: TownMicroRouteWindow;
  seasonOverride?: TownSeasonKey;
}): Promise<{
  pack: DailyOutput;
  historyId: string;
  chosenGoal: DailyGoal;
  chosenPlatform: DailyPlatform;
  queue: {
    postPublishOutboxId?: string;
    gbpOutboxId?: string;
    emailOutboxId?: string;
  };
}> {
  const adapter = getAdapter();
  const parsedRequest = dailyRequestSchema.parse(input.request ?? {});
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const location =
    input.locationId && input.locationId.trim() !== ""
      ? await getLocationById(input.userId, input.brandId, input.locationId.trim())
      : null;
  if (input.locationId && !location) {
    throw new Error(`Location '${input.locationId}' was not found`);
  }
  const [settings, voiceProfile, insightsCache, townPulseModel] = await Promise.all([
    adapter.getAutopilotSettings(input.userId, input.brandId),
    getBrandVoiceProfile(input.userId, input.brandId).catch(() => null),
    getOrRefreshInsightsCache({
      userId: input.userId,
      brandId: input.brandId,
      rangeDays: 30,
    }),
    getTownPulseModelForBrand({
      userId: input.userId,
      brandId: input.brandId,
      recomputeIfMissing: true,
    }).catch(() => null),
  ]);
  const timezone = timezoneOrDefault(location?.timezone ?? settings?.timezone ?? "America/Chicago");
  const chosenGoal = parsedRequest.goal ?? defaultGoalFromClock(timezone);
  const preferred = preferredPlatformFromSettings(settings?.channels);
  const chosenPlatform = await selectPlatform({
    userId: input.userId,
    brandId: input.brandId,
    preferred,
  });
  const timingPlatform = chosenPlatform === "gbp" ? "instagram" : chosenPlatform;
  const timingModel = await getOrRecomputeTimingModel({
    userId: input.userId,
    brandId: input.brandId,
    platform: timingPlatform,
    rangeDays: 60,
  }).catch(() => null);
  const upcomingEvents = await getUpcomingLocalEvents(input.userId, input.brandId, 3);
  const recentPosts = recentPostSnapshots(await adapter.listPosts(input.userId, input.brandId, 30));

  const promptOutput = await runPrompt({
    promptFile: "daily_one_button.md",
    brandProfile: brand,
    userId: input.userId,
    locationContext: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          timezone: location.timezone,
        }
      : undefined,
    input: {
      brand,
      communityVibeProfile: brand.communityVibeProfile,
      voiceProfile: voiceProfile
        ? {
            styleSummary: voiceProfile.styleSummary,
            emojiStyle: voiceProfile.emojiStyle,
            energyLevel: voiceProfile.energyLevel,
            phrasesToRepeat: voiceProfile.phrasesToRepeat,
            doNotUse: voiceProfile.doNotUse,
          }
        : undefined,
      timingModel: timingModel?.model,
      insightsSummary: insightsCache.insights,
      townPulse: townPulseModel?.model,
      notes: parsedRequest.notes,
      goal: chosenGoal,
      bestPlatform: chosenPlatform,
      upcomingEventTieIn: upcomingEvents[0] ?? null,
      location: location
        ? {
            id: location.id,
            name: location.name,
            address: location.address,
            timezone: location.timezone,
          }
        : undefined,
    },
    outputSchema: dailyOutputSchema,
  });

  const localBoostSuggestion = await runPrompt({
    promptFile: "local_boost.md",
    brandProfile: brand,
    userId: input.userId,
    locationContext: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          timezone: location.timezone,
        }
      : undefined,
    input: {
      brand,
      communityVibeProfile: brand.communityVibeProfile,
      recentPosts,
      goal: chosenGoal,
    },
    outputSchema: localBoostOutputSchema,
  }).catch(() => null);
  const townBoostSuggestion = await buildTownBoostForDaily({
    userId: input.userId,
    brandId: input.brandId,
    brand,
    goal: chosenGoal,
  }).catch(() => null);
  const latestTownStory = await getLatestTownStoryForBrand({
    userId: input.userId,
    brandId: input.brandId,
  }).catch(() => null);
  const townPulseBoost = townPulseModel
    ? await buildTownPulsePromptSuggestion({
        userId: input.userId,
        brand,
        townPulse: townPulseModel.model,
      }).catch(() => null)
    : null;
  const mergedTownBoost =
    townBoostSuggestion?.townBoost ??
    (townPulseBoost
      ? {
          line: townPulseBoost.angle,
          captionAddOn: townPulseBoost.captionAddOn,
          staffScript: townPulseBoost.timingHint,
        }
      : undefined);
  const dailyTownStory = latestTownStory
    ? {
        headline: latestTownStory.content.headline,
        captionAddOn: latestTownStory.content.socialCaption,
        staffLine: latestTownStory.content.signLine || latestTownStory.content.conversationStarter,
      }
    : undefined;
  const townGraphBoostSuggestion = await buildTownGraphBoostForDaily({
    userId: input.userId,
    brandId: input.brandId,
    brand,
    townPulse: townPulseModel?.model,
    voiceProfile: voiceProfile
      ? {
          styleSummary: voiceProfile.styleSummary,
          emojiStyle: voiceProfile.emojiStyle,
          energyLevel: voiceProfile.energyLevel,
          phrasesToRepeat: voiceProfile.phrasesToRepeat,
          doNotUse: voiceProfile.doNotUse,
        }
      : undefined,
  }).catch(() => null);
  const townMicroRouteSuggestion = await buildTownMicroRouteForDaily({
    userId: input.userId,
    brandId: input.brandId,
    brand,
    goal: chosenGoal,
    timezone,
    townPulse: townPulseModel?.model,
    windowOverride: input.windowOverride,
    seasonOverride: input.seasonOverride,
  }).catch(() => null);
  const townSeasonalBoostSuggestion = await buildTownSeasonalBoostForDaily({
    userId: input.userId,
    brandId: input.brandId,
    brand,
    goal: chosenGoal,
    timezone,
    townPulse: townPulseModel?.model,
    windowOverride: input.windowOverride,
    seasonOverride: input.seasonOverride,
  }).catch(() => null);
  if (townPulseBoost && mergedTownBoost && townBoostSuggestion?.townBoost) {
    const captionAddOn = `${mergedTownBoost.captionAddOn} ${townPulseBoost.captionAddOn}`.trim();
    mergedTownBoost.captionAddOn = captionAddOn;
    mergedTownBoost.staffScript = `${mergedTownBoost.staffScript} ${townPulseBoost.timingHint}`.trim();
  }
  if (brand.townRef && mergedTownBoost) {
    const fromCategory = townGraphCategoryFromBrandType(brand.type);
    const hintedCategory = inferTownGraphCategoryFromText(
      `${mergedTownBoost.line} ${mergedTownBoost.captionAddOn} ${mergedTownBoost.staffScript}`,
    );
    if (hintedCategory && hintedCategory !== fromCategory) {
      await addTownGraphEdge({
        townId: brand.townRef,
        fromCategory,
        toCategory: hintedCategory,
        weight: 0.75,
        userId: input.userId,
      }).catch(() => {
        // Town Graph is a best-effort intelligence layer.
      });
    }
  }

  const twilioIntegration = await adapter.getIntegration(input.userId, input.brandId, "twilio");
  const pack = dailyOutputSchema.parse({
    ...promptOutput,
    post: {
      ...promptOutput.post,
      platform: sanitizeDailyPlatform(promptOutput.post.platform),
    },
    optionalSms: {
      ...promptOutput.optionalSms,
      enabled: Boolean(twilioIntegration),
    },
    localBoost: localBoostSuggestion
      ? {
          line: localBoostSuggestion.localAngle,
          captionAddOn: localBoostSuggestion.captionAddOn,
          staffScript: localBoostSuggestion.staffLine,
        }
      : undefined,
    townBoost: mergedTownBoost,
    townStory: dailyTownStory,
    townGraphBoost: townGraphBoostSuggestion?.townGraphBoost,
    townMicroRoute: townMicroRouteSuggestion?.townMicroRoute,
    townSeasonalBoost: townSeasonalBoostSuggestion?.townSeasonalBoost,
  });

  const history = await adapter.addHistory(
    input.userId,
    input.brandId,
    "daily_one_button",
    {
      notes: parsedRequest.notes,
      requestedGoal: parsedRequest.goal,
      chosenGoal,
      chosenPlatform,
      timezone,
      eventTieIn: upcomingEvents[0] ?? null,
      locationId: location?.id,
      windowOverride: input.windowOverride,
      seasonOverride: input.seasonOverride,
    },
    {
      pack,
    },
  );

  if (latestTownStory) {
    await recordTownStoryUsageForBrand({
      userId: input.userId,
      brandId: input.brandId,
      townStoryRef: latestTownStory.id,
    }).catch(() => {
      // Story usage tracking is best-effort.
    });
  }

  const queue: { postPublishOutboxId?: string; gbpOutboxId?: string; emailOutboxId?: string } = {};
  const autoPostEnabled = Boolean(settings?.enabled);
  const scheduleIso = scheduleIsoForBestTime({
    timezone,
    bestTime: pack.post.bestTime,
    fallbackHour: timingModel?.model.bestHours[0] ?? settings?.hour ?? 15,
  });

  if (autoPostEnabled) {
    const bufferIntegration = await adapter.getIntegration(input.userId, input.brandId, "buffer");
    if (bufferIntegration) {
      const config =
        typeof bufferIntegration.config === "object" && bufferIntegration.config !== null
          ? (bufferIntegration.config as Record<string, unknown>)
          : {};
      const rawProfiles = Array.isArray(config.profiles) ? config.profiles : [];
      const profiles = rawProfiles
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return null;
          }
          const row = entry as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id : "";
          const service = typeof row.service === "string" ? row.service : "";
          return id && service ? { id, service } : null;
        })
        .filter((entry): entry is BufferProfile => entry !== null);
      const publishPlatform = socialPublishPlatform(pack.post.platform as DailyPlatform);
      const bufferProfileId = resolveBufferProfileId({
        platform: publishPlatform,
        profileId: location?.bufferProfileId,
        profiles,
      });
      if (bufferProfileId) {
        const outbox = await adapter.enqueueOutbox(
          input.userId,
          input.brandId,
          "post_publish",
          {
            platform: publishPlatform,
            caption: pack.post.caption,
            source: "manual",
            promoName: pack.todaySpecial.promoName,
            notes: `Daily one-button pack (${history.id})`,
            bufferProfileId,
            locationId: location?.id,
            locationName: location?.name,
          },
          scheduleIso,
        );
        queue.postPublishOutboxId = outbox.id;
        await adapter.addPost(input.userId, input.brandId, {
          platform: publishPlatform,
          postedAt: scheduleIso,
          mediaType: "text",
          captionUsed: pack.post.caption,
          promoName: pack.todaySpecial.promoName,
          notes: `Planned from one-button daily pack (${history.id})`,
          status: "planned",
          providerMeta: {
            outboxId: outbox.id,
            source: "daily_one_button",
            locationId: location?.id,
          },
        });
      }
    }

    const gbpIntegration = await adapter.getIntegration(input.userId, input.brandId, "google_business");
    if (gbpIntegration && (settings?.channels.includes("google_business") ?? false)) {
      const config =
        typeof gbpIntegration.config === "object" && gbpIntegration.config !== null
          ? (gbpIntegration.config as Record<string, unknown>)
          : {};
      const locations = Array.isArray(config.locations) ? config.locations : [];
      const fallbackLocation =
        typeof config.locationName === "string" ? config.locationName : undefined;
      const firstLocation = locations.find(
        (entry) => typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).name === "string",
      ) as Record<string, unknown> | undefined;
      const locationName =
        location?.googleLocationName ??
        (firstLocation ? String(firstLocation.name) : undefined) ??
        fallbackLocation;
      if (locationName) {
        const gbpOutbox = await adapter.enqueueOutbox(
          input.userId,
          input.brandId,
          "gbp_post",
          {
            locationName,
            summary: `${pack.todaySpecial.promoName}: ${pack.todaySpecial.offer}`,
            callToActionUrl: undefined,
            locationId: location?.id,
            locationLabel: location?.name,
          },
          scheduleIso,
        );
        queue.gbpOutboxId = gbpOutbox.id;
      }
    }

  }

  const emailTarget = latestEmail({
    notifyEmail: settings?.notifyEmail,
    ownerEmail: input.ownerEmail ?? null,
  });
  if (emailTarget && isEmailEnabled()) {
    const subject = `${brand.businessName} — Daily Action Pack`;
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:16px;">
      <h2>${brand.businessName} — Daily Action Pack</h2>
      <p><strong>Today’s Special:</strong> ${pack.todaySpecial.promoName}</p>
      <p>${pack.todaySpecial.offer} (${pack.todaySpecial.timeWindow})</p>
      <p><strong>Post:</strong> ${pack.post.caption}</p>
      <p><strong>Sign:</strong> ${pack.sign.headline} — ${pack.sign.body}</p>
      ${
        pack.localBoost
          ? `<p><strong>Local Boost:</strong> ${pack.localBoost.line}<br/>${pack.localBoost.captionAddOn}<br/>${pack.localBoost.staffScript}</p>`
          : ""
      }
      ${
        pack.townBoost
          ? `<p><strong>Town Boost:</strong> ${pack.townBoost.line}<br/>${pack.townBoost.captionAddOn}<br/>${pack.townBoost.staffScript}</p>`
          : ""
      }
      ${
        pack.townStory
          ? `<p><strong>Town Story:</strong> ${pack.townStory.headline}<br/>${pack.townStory.captionAddOn}<br/>${pack.townStory.staffLine}</p>`
          : ""
      }
      ${
        pack.townGraphBoost
          ? `<p><strong>Town Graph Boost:</strong> ${pack.townGraphBoost.nextStopIdea}<br/>${pack.townGraphBoost.captionAddOn}<br/>${pack.townGraphBoost.staffLine}</p>`
          : ""
      }
      ${
        pack.townMicroRoute
          ? `<p><strong>Town Route Tip (${pack.townMicroRoute.window}):</strong> ${pack.townMicroRoute.line}<br/>${pack.townMicroRoute.captionAddOn}<br/>${pack.townMicroRoute.staffScript}</p>`
          : ""
      }
      ${
        pack.townSeasonalBoost
          ? `<p><strong>Town Seasonal Boost:</strong> [${pack.townSeasonalBoost.seasonTags.join(", ")}] ${pack.townSeasonalBoost.line}<br/>${pack.townSeasonalBoost.captionAddOn}<br/>${pack.townSeasonalBoost.staffScript}</p>`
          : ""
      }
    </body></html>`;
    const log = await adapter.addEmailLog(input.userId, input.brandId, {
      toEmail: emailTarget,
      subject,
      status: "queued",
    });
    const emailOutbox = await adapter.enqueueOutbox(
      input.userId,
      input.brandId,
      "email_send",
      {
        toEmail: emailTarget,
        subject,
        html,
        textSummary: `${pack.todaySpecial.promoName} | ${pack.post.caption}`,
        emailLogId: log.id,
      },
      new Date().toISOString(),
    );
    queue.emailOutboxId = emailOutbox.id;
  }

  return {
    pack,
    historyId: history.id,
    chosenGoal,
    chosenPlatform,
    queue,
  };
}

export async function runRescueOneButton(input: {
  userId: string;
  brandId: string;
  locationId?: string;
  request?: RescueRequest;
}): Promise<{ output: RescueOutput; historyId: string }> {
  const adapter = getAdapter();
  const parsedRequest = rescueRequestSchema.parse(input.request ?? {});
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const location =
    input.locationId && input.locationId.trim() !== ""
      ? await getLocationById(input.userId, input.brandId, input.locationId.trim())
      : null;
  if (input.locationId && !location) {
    throw new Error(`Location '${input.locationId}' was not found`);
  }
  const insightsCache = await getOrRefreshInsightsCache({
    userId: input.userId,
    brandId: input.brandId,
    rangeDays: 30,
  });
  const output = await runPrompt({
    promptFile: "rescue_one_button.md",
    brandProfile: brand,
    userId: input.userId,
    locationContext: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          timezone: location.timezone,
        }
      : undefined,
    input: {
      brand,
      insightsSummary: insightsCache.insights,
      whatHappened: parsedRequest.whatHappened,
      timeLeftToday: parsedRequest.timeLeftToday,
      location: location
        ? {
            id: location.id,
            name: location.name,
            address: location.address,
            timezone: location.timezone,
          }
        : undefined,
    },
    outputSchema: rescueOutputSchema,
  });

  const history = await adapter.addHistory(
    input.userId,
    input.brandId,
    "rescue_one_button",
    parsedRequest,
    output,
  );
  await writeTownPulseSignalForBrand({
    userId: input.userId,
    brand,
    signalType: "slow",
    weight: 1.1,
  }).catch(() => {
    // Town Pulse is optional intelligence.
  });
  return {
    output,
    historyId: history.id,
  };
}

export async function runLocalCollab(input: {
  userId: string;
  brandId: string;
  request?: LocalCollabRequest;
}): Promise<LocalCollabOutput> {
  const adapter = getAdapter();
  const parsedRequest = localCollabRequestSchema.parse(input.request ?? {});
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const settings = await adapter.getAutopilotSettings(input.userId, input.brandId).catch(() => null);
  const timezone = timezoneOrDefault(settings?.timezone ?? "America/Chicago");
  const chosenGoal = parsedRequest.goal ?? defaultGoalFromClock(timezone);
  const recentPosts = recentPostSnapshots(await adapter.listPosts(input.userId, input.brandId, 30));
  const output = await runPrompt({
    promptFile: "local_collab.md",
    brandProfile: brand,
    userId: input.userId,
    input: {
      brand,
      communityVibeProfile: brand.communityVibeProfile,
      recentPosts,
      goal: chosenGoal,
      notes: parsedRequest.notes,
    },
    outputSchema: localCollabOutputSchema,
  });
  if (brand.townRef) {
    const fromCategory = townGraphCategoryFromBrandType(brand.type);
    const toCategory =
      output.partnerCategory ??
      inferTownGraphCategoryFromText(`${output.idea} ${output.caption} ${output.howToAsk}`);
    if (toCategory && toCategory !== fromCategory) {
      await addTownGraphEdge({
        townId: brand.townRef,
        fromCategory,
        toCategory,
        userId: input.userId,
        weight: 1.15,
      }).catch(() => {
        // Graph updates should not block collab suggestions.
      });
    }
  }
  return output;
}

export async function getLatestDailyPack(userId: string, brandId: string): Promise<DailyPackRecord | null> {
  const history = await getAdapter().listHistory(userId, brandId, 200);
  for (const entry of history) {
    if (entry.endpoint !== "daily_one_button") {
      continue;
    }
    const response = typeof entry.response === "object" && entry.response !== null ? (entry.response as Record<string, unknown>) : null;
    const packRaw =
      response && typeof response.pack === "object" && response.pack !== null
        ? response.pack
        : entry.response;
    const parsed = dailyOutputSchema.safeParse(packRaw);
    if (parsed.success) {
      return {
        id: entry.id,
        createdAt: entry.createdAt,
        output: parsed.data,
        response: entry.response,
      };
    }
  }
  return null;
}

export async function dailyCheckinStatus(userId: string, brandId: string): Promise<{
  pending: boolean;
  latestPackId?: string;
  latestPackAt?: string;
}> {
  const latest = await getLatestDailyPack(userId, brandId);
  if (!latest) {
    return { pending: false };
  }
  const createdMs = new Date(latest.createdAt).getTime();
  if (!Number.isFinite(createdMs) || Date.now() - createdMs < 24 * 60 * 60 * 1000) {
    return { pending: false, latestPackId: latest.id, latestPackAt: latest.createdAt };
  }
  const metrics = await getAdapter().listMetrics(userId, brandId, 200);
  const alreadyCheckedIn = metrics.some(
    (metric) =>
      typeof metric.salesNotes === "string" &&
      metric.salesNotes.includes(`daily_checkin:${latest.id}:`),
  );
  return {
    pending: !alreadyCheckedIn,
    latestPackId: latest.id,
    latestPackAt: latest.createdAt,
  };
}

export async function submitDailyCheckin(input: {
  userId: string;
  brandId: string;
  request: DailyCheckinRequest;
}): Promise<{ status: "saved" | "skipped"; reason?: string }> {
  const parsed = dailyCheckinRequestSchema.parse(input.request);
  const latest = await getLatestDailyPack(input.userId, input.brandId);
  if (!latest) {
    return { status: "skipped", reason: "No daily pack found yet" };
  }
  const existing = await getAdapter().listMetrics(input.userId, input.brandId, 200);
  const alreadyCheckedIn = existing.some(
    (metric) =>
      typeof metric.salesNotes === "string" &&
      metric.salesNotes.includes(`daily_checkin:${latest.id}:`),
  );
  if (alreadyCheckedIn) {
    return { status: "skipped", reason: "Already checked in for latest daily pack" };
  }
  const brand = await getAdapter().getBrand(input.userId, input.brandId);
  const platform = sanitizeDailyPlatform(latest.output.post.platform);
  const metricsRecord = await getAdapter().addMetrics(input.userId, input.brandId, {
    platform: platform === "gbp" ? "other" : platform,
    window: "24h",
    salesNotes: `${notesForOutcome(parsed.outcome)} | daily_checkin:${latest.id}:${parsed.outcome}`,
    redemptions: parsed.redemptions,
  });
  await writeTownPulseForDailyOutcome({
    userId: input.userId,
    brand,
    outcome: parsed.outcome,
    occurredAt: metricsRecord.createdAt,
  }).catch(() => {
    // Town Pulse should not block check-in writes.
  });
  return { status: "saved" };
}
