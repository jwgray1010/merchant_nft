import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import { historyRecordSchema } from "../schemas/historySchema";
import { insightsOutputSchema, type InsightsOutput } from "../schemas/insightsOutputSchema";
import { storedMetricsSchema, type StoredMetrics } from "../schemas/metricsSchema";
import { storedPostSchema, type StoredPost } from "../schemas/postSchema";
import { getAdapter } from "../storage/getAdapter";

const legacyHistoryEntrySchema = z.object({
  id: z.string().optional(),
  brandId: z.string(),
  endpoint: z.string(),
  createdAt: z.string(),
  request: z.unknown(),
  response: z.unknown(),
  tags: z.array(z.string()).optional(),
});

type HistoryEntry = z.infer<typeof legacyHistoryEntrySchema>;

const DAYS_LOOKBACK = 30;
const MAX_ENTRIES = 100;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "you",
  "our",
  "are",
  "was",
  "were",
  "have",
  "has",
  "get",
  "off",
  "any",
  "all",
  "day",
  "today",
  "special",
  "offer",
  "promo",
]);

function isRecent(createdAt: string, days = DAYS_LOOKBACK): boolean {
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return false;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return parsedDate.getTime() >= cutoff;
}

function pickRecentEntries<T extends { createdAt: string }>(entries: T[]): T[] {
  return entries.filter((entry) => isRecent(entry.createdAt)).slice(0, MAX_ENTRIES);
}

function maybeNumber(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function computeMetricScore(metric: StoredMetrics): number {
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

function extractOfferStrings(response: unknown): string[] {
  const offers: string[] = [];

  function walk(value: unknown, keyHint?: string): void {
    if (typeof value === "string") {
      if (keyHint && /(offer|promo|special|hook)/i.test(keyHint)) {
        offers.push(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, keyHint);
      }
      return;
    }

    if (typeof value === "object" && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        walk(nested, key);
      }
    }
  }

  walk(response);
  return offers;
}

function mostCommonOfferWords(history: HistoryEntry[]): string[] {
  const counter = new Map<string, number>();

  for (const entry of history) {
    for (const text of extractOfferStrings(entry.response)) {
      const words = text.toLowerCase().split(/[^a-z0-9]+/g);
      for (const word of words) {
        if (word.length < 3 || STOP_WORDS.has(word)) {
          continue;
        }
        counter.set(word, (counter.get(word) ?? 0) + 1);
      }
    }
  }

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function mostFrequentPostingHours(posts: StoredPost[]): string[] {
  const hours = new Map<number, number>();

  for (const post of posts) {
    const date = new Date(post.postedAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const hour = date.getUTCHours();
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
  }

  return [...hours.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => `${hour.toString().padStart(2, "0")}:00 UTC`);
}

function platformAverages(metrics: StoredMetrics[]): Array<Record<string, unknown>> {
  const grouped = new Map<
    string,
    { viewsTotal: number; viewsCount: number; likesTotal: number; likesCount: number; samples: number }
  >();

  for (const metric of metrics) {
    const current = grouped.get(metric.platform) ?? {
      viewsTotal: 0,
      viewsCount: 0,
      likesTotal: 0,
      likesCount: 0,
      samples: 0,
    };

    if (typeof metric.views === "number") {
      current.viewsTotal += metric.views;
      current.viewsCount += 1;
    }
    if (typeof metric.likes === "number") {
      current.likesTotal += metric.likes;
      current.likesCount += 1;
    }
    current.samples += 1;
    grouped.set(metric.platform, current);
  }

  return [...grouped.entries()].map(([platform, values]) => ({
    platform,
    avgViews: values.viewsCount > 0 ? Number((values.viewsTotal / values.viewsCount).toFixed(2)) : null,
    avgLikes: values.likesCount > 0 ? Number((values.likesTotal / values.likesCount).toFixed(2)) : null,
    samples: values.samples,
  }));
}

export function buildRecentTopPosts(posts: StoredPost[], metrics: StoredMetrics[]): Array<Record<string, unknown>> {
  const postsById = new Map(posts.map((post) => [post.id, post]));

  const scored = metrics
    .map((metric) => {
      if (!metric.postId) {
        return null;
      }

      const post = postsById.get(metric.postId);
      if (!post) {
        return null;
      }

      return {
        postId: post.id,
        platform: post.platform,
        postedAt: post.postedAt,
        mediaType: post.mediaType,
        captionUsed: post.captionUsed,
        score: Number(computeMetricScore(metric).toFixed(2)),
        metrics: {
          window: metric.window,
          views: maybeNumber(metric.views),
          likes: maybeNumber(metric.likes),
          comments: maybeNumber(metric.comments),
          shares: maybeNumber(metric.shares),
          saves: maybeNumber(metric.saves),
          clicks: maybeNumber(metric.clicks),
          redemptions: maybeNumber(metric.redemptions),
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length > 0) {
    return scored;
  }

  return posts.slice(0, 5).map((post) => ({
    postId: post.id,
    platform: post.platform,
    postedAt: post.postedAt,
    mediaType: post.mediaType,
    captionUsed: post.captionUsed,
  }));
}

export async function loadRecentLearningData(userId: string, brandId: string): Promise<{
  history: HistoryEntry[];
  posts: StoredPost[];
  metrics: StoredMetrics[];
  aggregates: Record<string, unknown>;
  previousWeekPlans: unknown[];
  recentTopPosts: Array<Record<string, unknown>>;
}> {
  const adapter = getAdapter();
  const [rawHistory, rawPosts, rawMetrics] = await Promise.all([
    adapter.listHistory(userId, brandId, 180),
    adapter.listPosts(userId, brandId, 180),
    adapter.listMetrics(userId, brandId, 180),
  ]);

  const history = pickRecentEntries(
    rawHistory
      .map((record) => {
        const strictResult = historyRecordSchema.safeParse(record);
        if (strictResult.success) {
          return strictResult;
        }
        return legacyHistoryEntrySchema.safeParse(record);
      })
      .filter((result): result is { success: true; data: HistoryEntry } => result.success)
      .map((result) => result.data),
  );

  const posts = pickRecentEntries(
    rawPosts
      .map((record) => storedPostSchema.safeParse(record))
      .filter((result): result is { success: true; data: StoredPost } => result.success)
      .map((result) => result.data),
  );

  const metrics = pickRecentEntries(
    rawMetrics
      .map((record) => storedMetricsSchema.safeParse(record))
      .filter((result): result is { success: true; data: StoredMetrics } => result.success)
      .map((result) => result.data),
  );

  const aggregates = {
    dataCoverage: {
      historyCount: history.length,
      postsCount: posts.length,
      metricsCount: metrics.length,
      note:
        metrics.length === 0
          ? "based on limited data (no metrics yet)"
          : "includes manual performance metrics",
    },
    platformAverages: platformAverages(metrics),
    commonOfferWords: mostCommonOfferWords(history),
    frequentPostingHours: mostFrequentPostingHours(posts),
  };

  const previousWeekPlans = history
    .filter((entry) => entry.endpoint === "week-plan" || entry.endpoint === "next-week-plan")
    .map((entry) => entry.response)
    .slice(0, 6);

  const recentTopPosts = buildRecentTopPosts(posts, metrics);

  return {
    history,
    posts,
    metrics,
    aggregates,
    previousWeekPlans,
    recentTopPosts,
  };
}

export async function generateInsights(brand: BrandProfile): Promise<{
  insights: InsightsOutput;
  history: HistoryEntry[];
  posts: StoredPost[];
  metrics: StoredMetrics[];
  aggregates: Record<string, unknown>;
  previousWeekPlans: unknown[];
  recentTopPosts: Array<Record<string, unknown>>;
}> {
  const fallbackUserId = process.env.LOCAL_DEV_USER_ID?.trim() || "local-dev-user";
  return generateInsightsForUser(fallbackUserId, brand);
}

export async function generateInsightsForUser(
  userId: string,
  brand: BrandProfile,
): Promise<{
  insights: InsightsOutput;
  history: HistoryEntry[];
  posts: StoredPost[];
  metrics: StoredMetrics[];
  aggregates: Record<string, unknown>;
  previousWeekPlans: unknown[];
  recentTopPosts: Array<Record<string, unknown>>;
}> {
  const recent = await loadRecentLearningData(userId, brand.brandId);

  const insights = await runPrompt({
    promptFile: "insights.md",
    brandProfile: brand,
    userId,
    input: {
      brand,
      history: recent.history,
      posts: recent.posts,
      metrics: recent.metrics,
      aggregates: recent.aggregates,
    },
    outputSchema: insightsOutputSchema,
  });

  return {
    insights,
    ...recent,
  };
}
