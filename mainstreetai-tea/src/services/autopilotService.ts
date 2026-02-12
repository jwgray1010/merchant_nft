import { runPrompt } from "../ai/runPrompt";
import { requirePlan } from "../billing/requirePlan";
import { isEmailEnabled, isTwilioEnabled } from "../integrations/env";
import {
  autopilotRunRequestSchema,
  autopilotDailyOutputSchema,
  type AutopilotDailyOutput,
  type AutopilotRunRequest,
} from "../schemas/autopilotRunSchema";
import {
  autopilotSettingsSchema,
  type AutopilotChannel,
  type AutopilotGoal,
  type AutopilotSettings,
  type ModelInsightsCache,
} from "../schemas/autopilotSettingsSchema";
import { getAdapter } from "../storage/getAdapter";
import { getUpcomingLocalEvents } from "./localEventAwareness";
import { generateInsightsForUser } from "./insightsService";
import {
  parsePostTimeToHourMinute,
  timezoneOrDefault,
  tomorrowDateInTimezone,
  zonedDateTimeToUtcIso,
} from "../utils/timezone";
import { getLocationById, listLocations } from "./locationStore";

const AUTOPILOT_RECENT_RUN_WINDOW_HOURS = 20;
const INSIGHTS_CACHE_STALE_HOURS = 24;

function schedulePlatformFromChannel(
  channel: AutopilotChannel,
): "facebook" | "instagram" | "tiktok" | "other" {
  if (channel === "facebook" || channel === "instagram" || channel === "tiktok") {
    return channel;
  }
  return "other";
}

function postPublishPlatformFromChannel(
  channel: AutopilotChannel,
): "facebook" | "instagram" | "tiktok" | "other" {
  return schedulePlatformFromChannel(channel);
}

function dayLabel(date: string, timezone: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "Tomorrow";
  }
  return parsed.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone });
}

function isStale(isoDate: string, staleAfterHours: number): boolean {
  const parsed = new Date(isoDate).getTime();
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return Date.now() - parsed > staleAfterHours * 60 * 60 * 1000;
}

function defaultSettings(userId: string, brandId: string): AutopilotSettings {
  const nowIso = new Date().toISOString();
  return autopilotSettingsSchema.parse({
    id: `default-${brandId}`,
    ownerId: userId,
    brandId,
    enabled: false,
    cadence: "daily",
    hour: 7,
    timezone: "America/Chicago",
    goals: ["repeat_customers", "slow_hours"],
    focusAudiences: [],
    channels: ["facebook", "instagram"],
    allowDiscounts: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

function inferBestPostTime(settings: AutopilotSettings, bestPostTimeRaw: string): {
  hour: number;
  minute: number;
} {
  const parsed = parsePostTimeToHourMinute(bestPostTimeRaw);
  if (parsed) {
    return parsed;
  }
  return {
    hour: Math.max(0, Math.min(23, settings.hour)),
    minute: 0,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildTomorrowReadyEmail(input: {
  businessName: string;
  date: string;
  output: AutopilotDailyOutput;
}): { subject: string; html: string; textSummary: string } {
  const subject = `${input.businessName} — Tomorrow Ready Pack (${input.date})`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 20px;">
    <h1 style="margin-bottom: 6px;">Tomorrow Ready Pack</h1>
    <p style="color: #6b7280; margin-top: 0;">${escapeHtml(input.businessName)} · ${escapeHtml(
      input.date,
    )}</p>
    <h2>Promo</h2>
    <p><strong>${escapeHtml(input.output.promo.promoName)}</strong></p>
    <p>${escapeHtml(input.output.promo.offer)}</p>
    <p><strong>Time:</strong> ${escapeHtml(input.output.promo.timeWindow)}</p>
    <h2>Social Caption</h2>
    <p>${escapeHtml(input.output.post.caption)}</p>
    <h2>In-store Sign</h2>
    <p>${escapeHtml(input.output.promo.inStoreSign)}</p>
    <h2>SMS</h2>
    <p>${escapeHtml(input.output.sms.message)}</p>
    <h2>GBP</h2>
    <p>${escapeHtml(input.output.gbp.summary)}</p>
  </body>
</html>`;

  const textSummary = [
    subject,
    "",
    `Promo: ${input.output.promo.promoName}`,
    `Offer: ${input.output.promo.offer}`,
    `Time: ${input.output.promo.timeWindow}`,
    "",
    `Caption: ${input.output.post.caption}`,
    "",
    `Sign: ${input.output.promo.inStoreSign}`,
    "",
    `SMS: ${input.output.sms.message}`,
    "",
    `GBP: ${input.output.gbp.summary}`,
  ].join("\n");

  return { subject, html, textSummary };
}

export async function getOrRefreshInsightsCache(input: {
  userId: string;
  brandId: string;
  rangeDays?: number;
}): Promise<ModelInsightsCache> {
  const adapter = getAdapter();
  const rangeDays = input.rangeDays ?? 30;
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }

  const existing = await adapter.getModelInsightsCache(input.userId, input.brandId, rangeDays);
  if (existing && !isStale(existing.computedAt, INSIGHTS_CACHE_STALE_HOURS)) {
    return existing;
  }

  const learning = await generateInsightsForUser(input.userId, brand);
  return adapter.upsertModelInsightsCache(
    input.userId,
    input.brandId,
    rangeDays,
    {
      insights: learning.insights,
      aggregates: learning.aggregates,
      previousWeekPlans: learning.previousWeekPlans,
      recentTopPosts: learning.recentTopPosts,
      sampleSizes: {
        history: learning.history.length,
        posts: learning.posts.length,
        metrics: learning.metrics.length,
      },
    },
    new Date().toISOString(),
  );
}

async function hasRecentAutopilotRun(userId: string, brandId: string): Promise<boolean> {
  const history = await getAdapter().listHistory(userId, brandId, 80);
  const cutoffMs = Date.now() - AUTOPILOT_RECENT_RUN_WINDOW_HOURS * 60 * 60 * 1000;
  return history.some((entry) => {
    if (entry.endpoint !== "autopilot_run") {
      return false;
    }
    const createdMs = new Date(entry.createdAt).getTime();
    return Number.isFinite(createdMs) && createdMs >= cutoffMs;
  });
}

function firstGoal(settings: AutopilotSettings): AutopilotGoal {
  return settings.goals[0] ?? "repeat_customers";
}

export async function runAutopilotForBrand(input: {
  userId: string;
  brandId: string;
  locationId?: string;
  request?: AutopilotRunRequest;
  source: "api" | "cron";
  enforceDailyGuard?: boolean;
}): Promise<{
  brandId: string;
  date: string;
  scheduledItems: number;
  outboxQueued: number;
  output: AutopilotDailyOutput;
  settings: AutopilotSettings;
  locationRuns: Array<{
    locationId?: string;
    locationName?: string;
    date: string;
    scheduledFor: string;
    scheduledItems: number;
    outboxQueued: number;
    output: AutopilotDailyOutput;
  }>;
}> {
  const adapter = getAdapter();
  const request = autopilotRunRequestSchema.parse(input.request ?? {});
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const planCheck = await requirePlan(input.userId, input.brandId, "pro");
  if (!planCheck.ok) {
    throw new Error("Upgrade required for autopilot");
  }

  const savedSettings = await adapter.getAutopilotSettings(input.userId, input.brandId);
  const settings = savedSettings ?? defaultSettings(input.userId, input.brandId);
  const defaultTimezone = timezoneOrDefault(settings.timezone);
  const targetDate = request.date ?? tomorrowDateInTimezone(defaultTimezone);

  if (input.enforceDailyGuard ?? true) {
    const recent = await hasRecentAutopilotRun(input.userId, input.brandId);
    if (recent) {
      throw new Error(
        "Autopilot already ran recently for this brand. Guardrail prevents more than one run within 20 hours.",
      );
    }
  }

  const insightsCache = await getOrRefreshInsightsCache({
    userId: input.userId,
    brandId: input.brandId,
    rangeDays: 30,
  });
  const upcomingEvents = await getUpcomingLocalEvents(input.userId, input.brandId, 7);
  const goal = request.goal ?? firstGoal(settings);
  const focusAudience = request.focusAudience ?? settings.focusAudiences[0];
  const requestedLocation =
    input.locationId && input.locationId.trim() !== ""
      ? await getLocationById(input.userId, input.brandId, input.locationId.trim())
      : null;
  if (input.locationId && !requestedLocation) {
    throw new Error(`Location '${input.locationId}' was not found`);
  }
  const knownLocations = requestedLocation
    ? [requestedLocation]
    : await listLocations(input.userId, input.brandId);
  const targets: Array<Awaited<ReturnType<typeof getLocationById>> | null> =
    knownLocations.length > 0 ? knownLocations : [null];

  const locationRuns: Array<{
    locationId?: string;
    locationName?: string;
    date: string;
    scheduledFor: string;
    scheduledItems: number;
    outboxQueued: number;
    output: AutopilotDailyOutput;
  }> = [];

  for (const location of targets) {
    const timezone = timezoneOrDefault(location?.timezone ?? settings.timezone);
    const generated = await runPrompt({
      promptFile: "autopilot_daily.md",
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
        date: targetDate,
        dayLabel: dayLabel(targetDate, timezone),
        goal,
        focusAudience,
        location: location
          ? {
              id: location.id,
              name: location.name,
              address: location.address,
              timezone: location.timezone,
            }
          : undefined,
        insights: insightsCache.insights,
        upcomingEvents,
        constraints: {
          maxDiscountText: settings.maxDiscountText,
          avoidControversy: Boolean(brand.constraints.avoidControversy),
        },
      },
      outputSchema: autopilotDailyOutputSchema,
    });

    const channels = settings.channels.length > 0 ? settings.channels : [generated.post.platform];
    const postTime = inferBestPostTime(settings, generated.post.bestPostTime);
    const scheduledForIso = zonedDateTimeToUtcIso({
      date: targetDate,
      hour: postTime.hour,
      minute: postTime.minute,
      timeZone: timezone,
    });

    let scheduledItems = 0;
    for (const channel of channels) {
      await adapter.addScheduleItem(input.userId, input.brandId, {
        title: location
          ? `${generated.promo.promoName} (${channel} · ${location.name})`
          : `${generated.promo.promoName} (${channel})`,
        platform: schedulePlatformFromChannel(channel),
        scheduledFor: scheduledForIso,
        caption: generated.post.caption,
        assetNotes: location
          ? `Autopilot generated (${targetDate}) for ${location.name}`
          : `Autopilot generated (${targetDate})`,
        status: "planned",
      });
      scheduledItems += 1;
    }

    let outboxQueued = 0;
    const bufferIntegration = await adapter.getIntegration(input.userId, input.brandId, "buffer");
    if (bufferIntegration) {
      for (const channel of channels) {
        if (channel === "google_business") {
          continue;
        }
        await adapter.enqueueOutbox(
          input.userId,
          input.brandId,
          "post_publish",
          {
            platform: postPublishPlatformFromChannel(channel),
            caption: generated.post.caption,
            source: "manual",
            notes: location
              ? `Autopilot queued for ${targetDate} (${location.name})`
              : `Autopilot queued for ${targetDate}`,
            ...(location?.bufferProfileId ? { bufferProfileId: location.bufferProfileId } : {}),
            ...(location
              ? {
                  locationId: location.id,
                  locationName: location.name,
                }
              : {}),
          },
          scheduledForIso,
        );
        outboxQueued += 1;
      }
    }

    const gbpIntegration = await adapter.getIntegration(input.userId, input.brandId, "google_business");
    if (gbpIntegration && generated.gbp.summary.trim() !== "") {
      const config =
        typeof gbpIntegration.config === "object" && gbpIntegration.config !== null
          ? (gbpIntegration.config as Record<string, unknown>)
          : {};
      const integrationLocations = Array.isArray(config.locations)
        ? config.locations
            .map((entry) => {
              if (typeof entry !== "object" || entry === null) {
                return null;
              }
              const row = entry as Record<string, unknown>;
              return typeof row.name === "string" ? row.name : null;
            })
            .filter((entry): entry is string => entry !== null)
        : [];
      const locationName =
        location?.googleLocationName ??
        integrationLocations[0] ??
        (typeof config.locationName === "string" ? config.locationName : undefined);
      if (locationName) {
        await adapter.enqueueOutbox(
          input.userId,
          input.brandId,
          "gbp_post",
          {
            locationName,
            summary: generated.gbp.summary,
            callToActionUrl: generated.gbp.ctaUrl,
            ...(location
              ? {
                  locationId: location.id,
                  locationLabel: location.name,
                }
              : {}),
          },
          scheduledForIso,
        );
        outboxQueued += 1;
      }
    }

    if (settings.notifyEmail && isEmailEnabled()) {
      const email = buildTomorrowReadyEmail({
        businessName: location ? `${brand.businessName} — ${location.name}` : brand.businessName,
        date: targetDate,
        output: generated,
      });
      const log = await adapter.addEmailLog(input.userId, input.brandId, {
        toEmail: settings.notifyEmail,
        subject: email.subject,
        status: "queued",
      });
      await adapter.enqueueOutbox(
        input.userId,
        input.brandId,
        "email_send",
        {
          toEmail: settings.notifyEmail,
          subject: email.subject,
          html: email.html,
          textSummary: email.textSummary,
          emailLogId: log.id,
          ...(location
            ? {
                locationId: location.id,
                locationName: location.name,
              }
            : {}),
        },
        new Date().toISOString(),
      );
      outboxQueued += 1;
    }

    if (settings.notifySms && isTwilioEnabled()) {
      const smsBody = location
        ? `${generated.sms.message} (${location.name})`
        : generated.sms.message;
      const smsMessage = await adapter.addSmsMessage(input.userId, input.brandId, {
        toPhone: settings.notifySms,
        body: smsBody,
        status: "queued",
        purpose: "reminder",
      });
      await adapter.enqueueOutbox(
        input.userId,
        input.brandId,
        "sms_send",
        {
          to: settings.notifySms,
          body: smsBody,
          purpose: "reminder",
          smsMessageId: smsMessage.id,
          ...(location
            ? {
                locationId: location.id,
                locationName: location.name,
              }
            : {}),
        },
        new Date().toISOString(),
      );
      outboxQueued += 1;
    }

    await adapter.addHistory(
      input.userId,
      input.brandId,
      "autopilot_run",
      {
        source: input.source,
        request,
        settings: {
          enabled: settings.enabled,
          cadence: settings.cadence,
          hour: settings.hour,
          timezone,
          channels,
          goals: settings.goals,
          focusAudiences: settings.focusAudiences,
        },
        ...(location
          ? {
              location: {
                id: location.id,
                name: location.name,
                address: location.address,
                timezone: location.timezone,
              },
            }
          : {}),
      },
      {
        date: targetDate,
        generated,
        scheduledFor: scheduledForIso,
        queuedCount: outboxQueued,
        scheduledItems,
      },
    );

    locationRuns.push({
      locationId: location?.id,
      locationName: location?.name,
      date: targetDate,
      scheduledFor: scheduledForIso,
      scheduledItems,
      outboxQueued,
      output: generated,
    });
  }

  const firstRun = locationRuns[0];
  if (!firstRun) {
    throw new Error("Autopilot did not produce any output");
  }

  return {
    brandId: input.brandId,
    date: targetDate,
    scheduledItems: locationRuns.reduce((sum, run) => sum + run.scheduledItems, 0),
    outboxQueued: locationRuns.reduce((sum, run) => sum + run.outboxQueued, 0),
    output: firstRun.output,
    settings,
    locationRuns,
  };
}
