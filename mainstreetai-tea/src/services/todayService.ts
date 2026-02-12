import { historyRecordSchema } from "../schemas/historySchema";
import { storedMetricsSchema } from "../schemas/metricsSchema";
import { storedPostSchema } from "../schemas/postSchema";
import { getAdapter } from "../storage/getAdapter";

export type TodayTask = {
  type: "post" | "promo" | "followup";
  title: string;
  notes: string;
};

function dateKeyLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayRange(date = new Date()): { from: string; to: string; dateKey: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    dateKey: dateKeyLocal(date),
  };
}

function snippet(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

export async function buildTodayTasks(userId: string, brandId: string): Promise<{
  date: string;
  tasks: TodayTask[];
}> {
  const adapter = getAdapter();
  const brand = await adapter.getBrand(userId, brandId);
  if (!brand) {
    throw new Error(`Brand '${brandId}' was not found`);
  }

  const { from, to, dateKey } = localDayRange(new Date());
  const tasks: TodayTask[] = [];

  const scheduleItems = await adapter.listSchedule(userId, brandId, { from, to });
  for (const item of scheduleItems) {
    if (item.status === "skipped") {
      continue;
    }
    const localTime = new Date(item.scheduledFor).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    tasks.push({
      type: "post",
      title: `${item.title} (${item.platform})`,
      notes: `${localTime} - ${snippet(item.caption, 120)}`,
    });
  }

  const rawHistory = await adapter.listHistory(userId, brandId, 40);

  const promoToday = rawHistory
    .map((entry) => historyRecordSchema.safeParse(entry))
    .filter((result): result is { success: true; data: ReturnType<typeof historyRecordSchema.parse> } => result.success)
    .map((result) => result.data)
    .find(
      (record) =>
        record.endpoint === "promo" && dateKeyLocal(new Date(record.createdAt)) === dateKey,
    );

  if (promoToday) {
    const response = promoToday.response;
    const promoName =
      typeof response === "object" && response !== null && typeof (response as { promoName?: unknown }).promoName === "string"
        ? (response as { promoName: string }).promoName
        : "Today's Promo";
    const offer =
      typeof response === "object" && response !== null && typeof (response as { offer?: unknown }).offer === "string"
        ? (response as { offer: string }).offer
        : "Use your current featured offer";

    tasks.push({
      type: "promo",
      title: `Run in-store promo: ${promoName}`,
      notes: offer,
    });
  } else {
    tasks.push({
      type: "promo",
      title: `Generate today's promo for ${brand.businessName}`,
      notes: "No promo generation found today yet.",
    });
  }

  const [rawPosts, rawMetrics] = await Promise.all([
    adapter.listPosts(userId, brandId, 120),
    adapter.listMetrics(userId, brandId, 200),
  ]);

  const posts = rawPosts
    .map((entry) => storedPostSchema.safeParse(entry))
    .filter((result): result is { success: true; data: ReturnType<typeof storedPostSchema.parse> } => result.success)
    .map((result) => result.data);

  const metrics = rawMetrics
    .map((entry) => storedMetricsSchema.safeParse(entry))
    .filter(
      (result): result is { success: true; data: ReturnType<typeof storedMetricsSchema.parse> } =>
        result.success,
    )
    .map((result) => result.data);

  const metricPostIds = new Set(metrics.map((metric) => metric.postId).filter(Boolean) as string[]);
  const nowMs = Date.now();
  const olderUnloggedPosts = posts.filter((post) => {
    const postedMs = new Date(post.postedAt).getTime();
    if (!Number.isFinite(postedMs)) {
      return false;
    }
    const isOlderThan24h = nowMs - postedMs >= 24 * 60 * 60 * 1000;
    return isOlderThan24h && !metricPostIds.has(post.id);
  });

  if (olderUnloggedPosts.length > 0) {
    const preview = olderUnloggedPosts
      .slice(0, 3)
      .map((post) => `${post.platform}: ${snippet(post.captionUsed, 40)}`)
      .join(" | ");
    tasks.push({
      type: "followup",
      title: `Log metrics from older posts (${olderUnloggedPosts.length})`,
      notes: preview,
    });
  } else {
    tasks.push({
      type: "followup",
      title: "Log metrics from yesterday",
      notes: "No pending post metrics detected right now.",
    });
  }

  return {
    date: dateKey,
    tasks,
  };
}
