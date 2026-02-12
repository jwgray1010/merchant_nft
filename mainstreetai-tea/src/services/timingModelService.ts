import { runPrompt } from "../ai/runPrompt";
import {
  postNowOutputSchema,
  type PostNowOutput,
  type PostNowRequest,
} from "../schemas/postNowSchema";
import { type MediaPlatform } from "../schemas/mediaSchema";
import { timingModelDataSchema, type TimingModelRecord } from "../schemas/timingSchema";
import type { StoredMetrics } from "../schemas/metricsSchema";
import type { StoredPost } from "../schemas/postSchema";
import { getAdapter } from "../storage/getAdapter";
import { getTimezoneParts, timezoneOrDefault, weekdayIndexFromShort } from "../utils/timezone";
import { getTimingModel, upsertTimingModel } from "./timingStore";

const DEFAULT_BEST_HOURS = [11, 15, 18];
const DEFAULT_BEST_DAYS = [2, 3, 4];

function metricScore(metric: StoredMetrics): number {
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

function decayWeight(daysAgo: number): number {
  return Math.exp(-Math.max(0, daysAgo) / 30);
}

function matchesPlatform(post: StoredPost, platform: MediaPlatform): boolean {
  if (platform === "gbp") {
    if (post.platform !== "other") {
      return false;
    }
    const provider =
      typeof post.providerMeta === "object" && post.providerMeta !== null
        ? (post.providerMeta as Record<string, unknown>).provider
        : undefined;
    return provider === "google_business" || /google business/i.test(post.notes ?? "");
  }
  if (platform === "other") {
    return post.platform === "other";
  }
  return post.platform === platform;
}

function averageScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const date = new Date(Date.UTC(2000, 0, 1, normalized, 0, 0));
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

function sortBestIndexes(values: Array<{ score: number; samples: number }>, fallback: number[]): number[] {
  const sorted = values
    .map((row, index) => ({ index, score: row.score, samples: row.samples }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.samples - a.samples;
    })
    .filter((row) => row.samples > 0)
    .map((row) => row.index);
  if (sorted.length === 0) {
    return fallback;
  }
  return sorted.slice(0, 3);
}

function summarizeRecentPerformance(posts: StoredPost[], metrics: StoredMetrics[]): Record<string, unknown> {
  const recentPosts = posts.slice(0, 20);
  const recentMetrics = metrics.slice(0, 40);
  const engagement = recentMetrics.map(metricScore).filter((value) => Number.isFinite(value));
  const avgEngagement = averageScore(engagement);
  const latestMetric = recentMetrics[0];
  return {
    recentPostCount: recentPosts.length,
    recentMetricCount: recentMetrics.length,
    avgEngagement: Number(avgEngagement.toFixed(2)),
    lastWindow: latestMetric?.window,
    lastSalesNote: latestMetric?.salesNotes,
  };
}

export async function recomputeTimingModel(input: {
  userId: string;
  brandId: string;
  platform: MediaPlatform;
  rangeDays?: number;
}): Promise<TimingModelRecord> {
  const rangeDays = Math.max(7, Math.min(365, Math.floor(input.rangeDays ?? 60)));
  const adapter = getAdapter();
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const timezone = timezoneOrDefault(
    (await adapter.getAutopilotSettings(input.userId, input.brandId))?.timezone,
  );

  const [postsRaw, metricsRaw] = await Promise.all([
    adapter.listPosts(input.userId, input.brandId, 1500),
    adapter.listMetrics(input.userId, input.brandId, 2000),
  ]);
  const cutoffMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const posts = postsRaw.filter((post) => {
    if (!matchesPlatform(post, input.platform)) {
      return false;
    }
    const postedMs = new Date(post.postedAt).getTime();
    return Number.isFinite(postedMs) && postedMs >= cutoffMs;
  });
  const metrics = metricsRaw.filter((metric) => {
    const createdMs = new Date(metric.createdAt).getTime();
    return Number.isFinite(createdMs) && createdMs >= cutoffMs;
  });

  const metricsByPost = new Map<string, StoredMetrics[]>();
  for (const metric of metrics) {
    if (!metric.postId) {
      continue;
    }
    const current = metricsByPost.get(metric.postId) ?? [];
    current.push(metric);
    metricsByPost.set(metric.postId, current);
  }

  const hourly = Array.from({ length: 24 }, () => ({
    weightedScore: 0,
    totalWeight: 0,
    samples: 0,
  }));
  const daily = Array.from({ length: 7 }, () => ({
    weightedScore: 0,
    totalWeight: 0,
    samples: 0,
  }));

  for (const post of posts) {
    const postedAt = new Date(post.postedAt);
    if (!Number.isFinite(postedAt.getTime())) {
      continue;
    }
    const parts = getTimezoneParts(postedAt, timezone);
    const hour = parts.hour;
    const day = weekdayIndexFromShort(parts.weekdayShort);
    if (hour < 0 || hour > 23 || day < 0 || day > 6) {
      continue;
    }
    const daysAgo = (Date.now() - postedAt.getTime()) / (24 * 60 * 60 * 1000);
    const weight = decayWeight(daysAgo);

    const postMetrics = metricsByPost.get(post.id) ?? [];
    const postScoreRaw =
      postMetrics.length > 0 ? averageScore(postMetrics.map(metricScore)) : 0.75;
    const postScore = Math.max(0.1, Math.log1p(postScoreRaw));

    hourly[hour].weightedScore += postScore * weight;
    hourly[hour].totalWeight += weight;
    hourly[hour].samples += 1;

    daily[day].weightedScore += postScore * weight;
    daily[day].totalWeight += weight;
    daily[day].samples += 1;
  }

  const hourlyScores = hourly.map((row, hour) => ({
    hour,
    score: row.totalWeight > 0 ? Number((row.weightedScore / row.totalWeight).toFixed(4)) : 0,
    samples: row.samples,
  }));
  const dayOfWeekScores = daily.map((row, dayOfWeek) => ({
    dayOfWeek,
    score: row.totalWeight > 0 ? Number((row.weightedScore / row.totalWeight).toFixed(4)) : 0,
    samples: row.samples,
  }));

  const fallbackUsed = posts.length === 0;
  const bestHours = fallbackUsed
    ? DEFAULT_BEST_HOURS
    : sortBestIndexes(hourlyScores, DEFAULT_BEST_HOURS);
  const bestDays = fallbackUsed
    ? DEFAULT_BEST_DAYS
    : sortBestIndexes(dayOfWeekScores, DEFAULT_BEST_DAYS);
  const bestTimeLabel = `${hourLabel(bestHours[0] ?? DEFAULT_BEST_HOURS[0])} (${timezone})`;

  const model = timingModelDataSchema.parse({
    rangeDays,
    sampleSize: posts.length,
    fallbackUsed,
    hourlyScores,
    dayOfWeekScores,
    bestHours,
    bestDays,
    bestTimeLabel,
    explainability: {
      scoreFormula:
        "engagement_score = log1p(views/100 + likes + comments*2 + shares*3 + saves*2 + clicks*2 + redemptions*4)",
      decay: "weight = exp(-daysAgo/30)",
      notes: fallbackUsed
        ? ["No matching post history in selected range; using default high-performing windows."]
        : ["More recent posts are weighted higher than older posts."],
    },
  });

  return upsertTimingModel(input.userId, input.brandId, input.platform, model);
}

export async function getOrRecomputeTimingModel(input: {
  userId: string;
  brandId: string;
  platform: MediaPlatform;
  rangeDays?: number;
}): Promise<TimingModelRecord> {
  const existing = await getTimingModel(input.userId, input.brandId, input.platform);
  if (existing) {
    return existing;
  }
  return recomputeTimingModel(input);
}

export async function runPostNowCoach(input: {
  userId: string;
  brandId: string;
  request: PostNowRequest;
}): Promise<{
  decision: PostNowOutput;
  timingModel: TimingModelRecord;
  recentPerformanceSummary: Record<string, unknown>;
}> {
  const adapter = getAdapter();
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const timezone = timezoneOrDefault(
    (await adapter.getAutopilotSettings(input.userId, input.brandId))?.timezone,
  );
  const timingModel = await getOrRecomputeTimingModel({
    userId: input.userId,
    brandId: input.brandId,
    platform: input.request.platform,
    rangeDays: 60,
  });

  const [posts, metrics] = await Promise.all([
    adapter.listPosts(input.userId, input.brandId, 150),
    adapter.listMetrics(input.userId, input.brandId, 250),
  ]);
  const recentPerformanceSummary = summarizeRecentPerformance(posts, metrics);

  const decision = await runPrompt({
    promptFile: "post_now.md",
    brandProfile: brand,
    userId: input.userId,
    input: {
      brand,
      platform: input.request.platform,
      now: new Date().toISOString(),
      timezone,
      timingModel: timingModel.model,
      recentPerformanceSummary,
      todayNotes: input.request.todayNotes ?? "",
      draftCaption: input.request.draftCaption ?? "",
    },
    outputSchema: postNowOutputSchema,
  });

  return {
    decision,
    timingModel,
    recentPerformanceSummary,
  };
}
