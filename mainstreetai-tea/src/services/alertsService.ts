import { runPrompt } from "../ai/runPrompt";
import { isEmailEnabled, isTwilioEnabled } from "../integrations/env";
import { anomalyRecommendationsOutputSchema, type AlertType } from "../schemas/alertSchema";
import type { StoredMetrics } from "../schemas/metricsSchema";
import type { StoredPost } from "../schemas/postSchema";
import type { ScheduleItem } from "../schemas/scheduleSchema";
import { getAdapter } from "../storage/getAdapter";
import { dateKeyInTimezone, timezoneOrDefault } from "../utils/timezone";
import { getOrRefreshInsightsCache } from "./autopilotService";

type AlertSignal = {
  type: AlertType;
  severity: "info" | "warning" | "urgent";
  message: string;
  details: Record<string, unknown>;
};

function metricScore(metric: StoredMetrics): number {
  const likes = metric.likes ?? 0;
  const views = metric.views ?? 0;
  return likes + views / 100;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function hasSalesSlowSignal(metric: StoredMetrics): boolean {
  const notes = (metric.salesNotes ?? "").toLowerCase();
  const flaggedByText = /\bslow|quiet|dead|not busy|no foot\b/.test(notes);
  const flaggedByRedemptions =
    typeof metric.redemptions === "number" && Number.isFinite(metric.redemptions) && metric.redemptions <= 0;
  return flaggedByText || flaggedByRedemptions;
}

function findMissedPostSignals(input: {
  now: Date;
  timezone: string;
  scheduleItems: ScheduleItem[];
  posts: StoredPost[];
  metrics: StoredMetrics[];
}): AlertSignal[] {
  const nowMs = input.now.getTime();
  const signals: AlertSignal[] = [];

  for (const item of input.scheduleItems) {
    if (item.status !== "planned") {
      continue;
    }
    const scheduledMs = new Date(item.scheduledFor).getTime();
    if (!Number.isFinite(scheduledMs)) {
      continue;
    }
    const hoursAgo = (nowMs - scheduledMs) / (60 * 60 * 1000);
    if (hoursAgo < 12 || hoursAgo > 60) {
      continue;
    }
    const hasMatchingPost = input.posts.some((post) => {
      if (post.platform !== item.platform && !(item.platform === "other" && post.platform === "other")) {
        return false;
      }
      const postedMs = new Date(post.postedAt).getTime();
      if (!Number.isFinite(postedMs)) {
        return false;
      }
      const deltaHours = Math.abs(postedMs - scheduledMs) / (60 * 60 * 1000);
      if (deltaHours > 36) {
        return false;
      }
      const sameCaption =
        post.captionUsed.trim().toLowerCase() === item.caption.trim().toLowerCase();
      return sameCaption || deltaHours <= 6;
    });
    const hasNearbyMetrics = input.metrics.some((metric) => {
      if (metric.platform !== item.platform && !(item.platform === "other" && metric.platform === "other")) {
        return false;
      }
      const metricMs = new Date(metric.createdAt).getTime();
      if (!Number.isFinite(metricMs)) {
        return false;
      }
      const deltaHours = Math.abs(metricMs - scheduledMs) / (60 * 60 * 1000);
      return deltaHours <= 36;
    });
    if (!hasMatchingPost && !hasNearbyMetrics) {
      const localDate = dateKeyInTimezone(new Date(item.scheduledFor), input.timezone);
      signals.push({
        type: "missed_post",
        severity: "warning",
        message: `Planned ${item.platform} post appears missed (${localDate})`,
        details: {
          scheduleId: item.id,
          platform: item.platform,
          scheduledFor: item.scheduledFor,
          caption: item.caption,
        },
      });
    }
  }

  return signals.slice(0, 2);
}

function findLowEngagementSignal(metrics: StoredMetrics[]): AlertSignal | null {
  const baselineScores = metrics.map(metricScore).filter((value) => Number.isFinite(value) && value > 0);
  if (baselineScores.length < 5) {
    return null;
  }
  const baselineMedian = median(baselineScores);
  if (!Number.isFinite(baselineMedian) || baselineMedian <= 0) {
    return null;
  }

  const latest = [...metrics]
    .filter((metric) => typeof metric.likes === "number" || typeof metric.views === "number")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  if (latest.length < 3) {
    return null;
  }
  const avgLatest = latest.reduce((sum, item) => sum + metricScore(item), 0) / latest.length;
  if (avgLatest >= baselineMedian * 0.6) {
    return null;
  }

  return {
    type: "low_engagement",
    severity: "warning",
    message: "Recent engagement dropped more than 40% below normal baseline.",
    details: {
      baselineMedian: Number(baselineMedian.toFixed(2)),
      last3Average: Number(avgLatest.toFixed(2)),
      sampleSize: baselineScores.length,
    },
  };
}

function findSlowDaySignal(input: {
  metrics: StoredMetrics[];
  timezone: string;
  autopilotEnabled: boolean;
  now: Date;
}): AlertSignal | null {
  const sorted = [...input.metrics].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recentByDay: Array<{ day: string; slow: boolean }> = [];
  const seenDays = new Set<string>();
  for (const metric of sorted) {
    const day = dateKeyInTimezone(new Date(metric.createdAt), input.timezone);
    if (seenDays.has(day)) {
      continue;
    }
    seenDays.add(day);
    recentByDay.push({
      day,
      slow: hasSalesSlowSignal(metric),
    });
    if (recentByDay.length >= 4) {
      break;
    }
  }
  const firstThree = recentByDay.slice(0, 3);
  if (firstThree.length >= 2 && firstThree.every((entry) => entry.slow)) {
    return {
      type: "slow_day",
      severity: "urgent",
      message: "Sales signals were slow for multiple recent days in a row.",
      details: {
        days: firstThree.map((entry) => entry.day),
      },
    };
  }

  if (input.autopilotEnabled) {
    const latestMetric = sorted[0];
    const latestMs = latestMetric ? new Date(latestMetric.createdAt).getTime() : NaN;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(latestMs) || input.now.getTime() - latestMs > sevenDaysMs) {
      return {
        type: "slow_day",
        severity: "info",
        message: "No recent metrics in 7 days. Log outcomes so autopilot can keep learning.",
        details: {
          lastMetricAt: latestMetric?.createdAt,
        },
      };
    }
  }

  return null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildAlertEmail(input: {
  businessName: string;
  type: AlertType;
  message: string;
  summary: string;
  actions: Array<{ action: string; why: string; readyCaption: string }>;
}): { subject: string; html: string; textSummary: string } {
  const subject = `${input.businessName} alert: ${input.type.replaceAll("_", " ")}`;
  const htmlActions = input.actions
    .map(
      (action) =>
        `<li><strong>${escapeHtml(action.action)}</strong><br/>${escapeHtml(action.why)}<br/><em>${escapeHtml(
          action.readyCaption,
        )}</em></li>`,
    )
    .join("");
  const html = `<!doctype html><html lang="en"><body style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 20px;">
<h1 style="margin-bottom: 8px;">Action Needed</h1>
<p><strong>${escapeHtml(input.message)}</strong></p>
<p>${escapeHtml(input.summary)}</p>
<ol>${htmlActions}</ol>
</body></html>`;
  const textSummary = [
    subject,
    "",
    input.message,
    input.summary,
    "",
    ...input.actions.map((action, index) => `${index + 1}. ${action.action} — ${action.why}\n${action.readyCaption}`),
  ].join("\n");
  return { subject, html, textSummary };
}

export async function detectAndQueueAlertsForBrand(input: {
  userId: string;
  brandId: string;
}): Promise<{
  created: number;
  skipped: number;
}> {
  const adapter = getAdapter();
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    return { created: 0, skipped: 0 };
  }
  const settings = await adapter.getAutopilotSettings(input.userId, input.brandId);
  const timezone = timezoneOrDefault(settings?.timezone);
  const now = new Date();
  const fromIso = new Date(now.getTime() - 60 * 60 * 1000 * 72).toISOString();
  const [scheduleItems, posts, metrics, openAlerts] = await Promise.all([
    adapter.listSchedule(input.userId, input.brandId, { from: fromIso }),
    adapter.listPosts(input.userId, input.brandId, 240),
    adapter.listMetrics(input.userId, input.brandId, 240),
    adapter.listAlerts(input.userId, input.brandId, { status: "open", limit: 200 }),
  ]);

  const existingTypes = new Set(openAlerts.map((entry) => entry.type));
  const signals: AlertSignal[] = [];
  for (const signal of findMissedPostSignals({ now, timezone, scheduleItems, posts, metrics })) {
    signals.push(signal);
  }
  const lowEngagementSignal = findLowEngagementSignal(metrics);
  if (lowEngagementSignal) {
    signals.push(lowEngagementSignal);
  }
  const slowDaySignal = findSlowDaySignal({
    metrics,
    timezone,
    autopilotEnabled: Boolean(settings?.enabled),
    now,
  });
  if (slowDaySignal) {
    signals.push(slowDaySignal);
  }

  let created = 0;
  let skipped = 0;

  const insights = await getOrRefreshInsightsCache({
    userId: input.userId,
    brandId: input.brandId,
    rangeDays: 30,
  }).catch(() => null);

  for (const signal of signals) {
    if (existingTypes.has(signal.type)) {
      skipped += 1;
      continue;
    }

    const recommendations = await runPrompt({
      promptFile: "anomaly_recommendations.md",
      brandProfile: brand,
      input: {
        brand,
        signal: {
          type: signal.type,
          details: signal.details,
        },
        insights: insights?.insights ?? {},
      },
      outputSchema: anomalyRecommendationsOutputSchema,
    });

    const alert = await adapter.addAlert(input.userId, input.brandId, {
      type: signal.type,
      severity: signal.severity,
      message: signal.message,
      status: "open",
      context: {
        signal: signal.details,
        recommendations,
      },
    });
    created += 1;
    existingTypes.add(signal.type);

    await adapter.addHistory(
      input.userId,
      input.brandId,
      "alert-recommendations",
      {
        signal: {
          type: signal.type,
          message: signal.message,
          details: signal.details,
        },
      },
      {
        alertId: alert.id,
        recommendations,
      },
    );

    const notifyEmail = settings?.notifyEmail?.trim();
    if (notifyEmail && isEmailEnabled()) {
      const email = buildAlertEmail({
        businessName: brand.businessName,
        type: signal.type,
        message: signal.message,
        summary: recommendations.summary,
        actions: recommendations.actions,
      });
      const emailLog = await adapter.addEmailLog(input.userId, input.brandId, {
        toEmail: notifyEmail,
        subject: email.subject,
        status: "queued",
      });
      await adapter.enqueueOutbox(
        input.userId,
        input.brandId,
        "email_send",
        {
          toEmail: notifyEmail,
          subject: email.subject,
          html: email.html,
          textSummary: email.textSummary,
          emailLogId: emailLog.id,
          alertId: alert.id,
        },
        new Date().toISOString(),
      );
    }

    const notifySms = settings?.notifySms?.trim();
    if (notifySms && isTwilioEnabled()) {
      const smsLog = await adapter.addSmsMessage(input.userId, input.brandId, {
        toPhone: notifySms,
        body: recommendations.sms.message,
        status: "queued",
        purpose: "reminder",
      });
      await adapter.enqueueOutbox(
        input.userId,
        input.brandId,
        "sms_send",
        {
          to: notifySms,
          body: recommendations.sms.message,
          purpose: "reminder",
          smsMessageId: smsLog.id,
          alertId: alert.id,
        },
        new Date().toISOString(),
      );
    }
  }

  return { created, skipped };
}
