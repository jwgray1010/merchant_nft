import { type TownMicroRouteWindow, townMicroRouteWindowSchema } from "../schemas/townGraphSchema";
import { getTimezoneParts, timezoneOrDefault, weekdayIndexFromShort } from "../utils/timezone";

export const TOWN_MICRO_ROUTE_WINDOWS: TownMicroRouteWindow[] = [
  "morning",
  "lunch",
  "after_work",
  "evening",
  "weekend",
];

function isWeekendDow(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function resolveTownWindowFromDayHour(input: {
  dayOfWeek: number;
  hour: number;
  preferUpcoming?: boolean;
}): TownMicroRouteWindow {
  const dayOfWeek = Math.max(0, Math.min(6, input.dayOfWeek));
  const hour = Math.max(0, Math.min(23, input.hour));
  if (isWeekendDow(dayOfWeek)) {
    return "weekend";
  }

  if (hour >= 6 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 13) return "lunch";
  if (hour >= 15 && hour <= 18) return "after_work";
  if (hour >= 18 && hour <= 21) return "evening";

  if (!input.preferUpcoming) {
    // Keep deterministic fallback for non-covered slots.
    if (hour < 6) return "morning";
    if (hour < 11) return "morning";
    if (hour < 15) return "lunch";
    if (hour < 18) return "after_work";
    if (hour < 21) return "evening";
    return dayOfWeek === 5 ? "weekend" : "morning";
  }

  // Upcoming-window preference is used for "what should I do next?" suggestions.
  if (hour < 11) return "morning";
  if (hour < 15) return "lunch";
  if (hour < 18) return "after_work";
  if (hour < 21) return "evening";
  return dayOfWeek === 5 ? "weekend" : "morning";
}

export function parseTownWindowOverride(raw: unknown): TownMicroRouteWindow | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = townMicroRouteWindowSchema.safeParse(raw.trim().toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

export function resolveTownWindow(input: {
  timezone: string;
  now?: Date;
  override?: TownMicroRouteWindow;
  preferUpcoming?: boolean;
}): TownMicroRouteWindow {
  if (input.override) {
    return input.override;
  }
  const tz = timezoneOrDefault(input.timezone);
  const parts = getTimezoneParts(input.now ?? new Date(), tz);
  const dow = weekdayIndexFromShort(parts.weekdayShort);
  return resolveTownWindowFromDayHour({
    dayOfWeek: dow >= 0 ? dow : 0,
    hour: parts.hour,
    preferUpcoming: input.preferUpcoming ?? true,
  });
}

export function townWindowLabel(window: TownMicroRouteWindow): string {
  if (window === "after_work") return "After Work";
  if (window === "weekend") return "Weekend";
  if (window === "morning") return "Morning";
  if (window === "lunch") return "Lunch";
  return "Evening";
}

export function doesWindowContainSlot(input: {
  window: TownMicroRouteWindow;
  dayOfWeek: number;
  hour: number;
}): boolean {
  const day = Math.max(0, Math.min(6, input.dayOfWeek));
  const hour = Math.max(0, Math.min(23, input.hour));
  if (input.window === "weekend") {
    return isWeekendDow(day);
  }
  if (isWeekendDow(day)) {
    return false;
  }
  if (input.window === "morning") return hour >= 6 && hour <= 10;
  if (input.window === "lunch") return hour >= 11 && hour <= 13;
  if (input.window === "after_work") return hour >= 15 && hour <= 18;
  return hour >= 18 && hour <= 21;
}
