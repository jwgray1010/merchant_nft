import { ownerConfidenceSummarySchema, type OwnerConfidenceSummary } from "../schemas/ownerConfidenceSchema";

type CheckinOutcome = "slow" | "okay" | "busy";

function isoDateFrom(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function lastSevenDates(today = new Date()): string[] {
  const rows: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    rows.push(isoDateFrom(day));
  }
  return rows;
}

function computeStreakDays(activeDays: Set<string>, today = new Date()): number {
  let streak = 0;
  for (let offset = 0; offset < 365; offset += 1) {
    const day = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = isoDateFrom(day);
    if (!activeDays.has(key)) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function trendSummary(input: {
  busyCount: number;
  okayCount: number;
  slowCount: number;
  rescueCount: number;
  activeDays7: number;
}): string {
  if (input.busyCount >= 2 && input.busyCount >= input.slowCount) {
    return "more positive check-ins this month";
  }
  if (input.rescueCount > 0 && input.slowCount > 0) {
    return "staying adaptive on slower days";
  }
  if (input.activeDays7 >= 4) {
    return "steady daily follow-through";
  }
  if (input.slowCount > input.busyCount) {
    return "mixed week with real-world ups and downs";
  }
  return "showing up and keeping momentum simple";
}

export function calcConfidence(input: {
  last7ActionDates: string[];
  last30ActionDates: string[];
  checkinOutcomesLast30: CheckinOutcome[];
  rescueActionsLast30: number;
  today?: Date;
}): OwnerConfidenceSummary {
  const today = input.today ?? new Date();
  const last7Keys = lastSevenDates(today);
  const actionDates7 = new Set(
    input.last7ActionDates
      .map((entry) => normalizeDate(entry))
      .filter((entry): entry is string => entry !== null),
  );
  const actionDates30 = new Set(
    input.last30ActionDates
      .map((entry) => normalizeDate(entry))
      .filter((entry): entry is string => entry !== null),
  );
  const last7DaysActive = last7Keys.map((key) => actionDates7.has(key));
  const shownUpDaysThisWeek = last7DaysActive.filter(Boolean).length;
  const streakDays = computeStreakDays(actionDates30, today);

  const busyCount = input.checkinOutcomesLast30.filter((entry) => entry === "busy").length;
  const okayCount = input.checkinOutcomesLast30.filter((entry) => entry === "okay").length;
  const slowCount = input.checkinOutcomesLast30.filter((entry) => entry === "slow").length;

  // Reward consistency over volume and avoid steep penalties for missed days.
  const consistencyScore =
    shownUpDaysThisWeek * 1.1 +
    Math.min(3.5, streakDays * 0.8) +
    Math.min(3.5, actionDates30.size / 3.5);
  const trendScore =
    (busyCount - slowCount) * 0.45 +
    okayCount * 0.2 +
    Math.min(1.4, input.rescueActionsLast30 * 0.35);
  const combined = consistencyScore + trendScore;

  const confidenceLevel =
    shownUpDaysThisWeek >= 4 && streakDays >= 3
      ? "rising"
      : combined >= 4.8
        ? "rising"
        : shownUpDaysThisWeek >= 2 || streakDays >= 1 || input.rescueActionsLast30 > 0
          ? "steady"
          : "low";

  const momentumHint =
    confidenceLevel === "rising"
      ? "You are building momentum through steady follow-through."
      : confidenceLevel === "steady"
        ? "Steady effort matters more than perfect days."
        : "A small action today can restart momentum.";

  const recentTrend = trendSummary({
    busyCount,
    okayCount,
    slowCount,
    rescueCount: input.rescueActionsLast30,
    activeDays7: shownUpDaysThisWeek,
  });

  return ownerConfidenceSummarySchema.parse({
    confidenceLevel,
    streakDays,
    momentumHint,
    recentTrend,
    shownUpDaysThisWeek,
    last7DaysActive,
  });
}
