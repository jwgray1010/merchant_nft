import { getTimezoneParts, timezoneOrDefault } from "../utils/timezone";
import {
  detectedTownSeasonSchema,
  townPrimarySeasonSchema,
  townSeasonKeySchema,
  type DetectedTownSeason,
  type TownPrimarySeason,
  type TownSeasonKey,
} from "../schemas/townSeasonSchema";

type SeasonRowLike = {
  seasonKey: TownSeasonKey;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
};

const SEASON_TAG_ORDER = [...townSeasonKeySchema.options] as TownSeasonKey[];

function monthDayKey(month: number, day: number): number {
  return month * 100 + day;
}

function parseIsoDateParts(input: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

function isDateWithinAbsoluteRange(input: {
  current: Date;
  startDate?: string | null;
  endDate?: string | null;
}): boolean {
  const start = parseIsoDateParts(input.startDate);
  const end = parseIsoDateParts(input.endDate);
  const currentIso = input.current.toISOString().slice(0, 10);
  const currentDate = new Date(`${currentIso}T12:00:00.000Z`);
  const currentMs = currentDate.getTime();
  if (!Number.isFinite(currentMs)) {
    return false;
  }
  if (!start && !end) {
    return true;
  }
  if (start && !end) {
    const startMs = new Date(`${start.year.toString().padStart(4, "0")}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}T00:00:00.000Z`).getTime();
    return Number.isFinite(startMs) ? currentMs >= startMs : false;
  }
  if (!start && end) {
    const endMs = new Date(`${end.year.toString().padStart(4, "0")}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}T23:59:59.999Z`).getTime();
    return Number.isFinite(endMs) ? currentMs <= endMs : false;
  }
  const startMs = new Date(`${start!.year.toString().padStart(4, "0")}-${String(start!.month).padStart(2, "0")}-${String(start!.day).padStart(2, "0")}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end!.year.toString().padStart(4, "0")}-${String(end!.month).padStart(2, "0")}-${String(end!.day).padStart(2, "0")}T23:59:59.999Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return false;
  }
  return currentMs >= startMs && currentMs <= endMs;
}

function isMonthDayRangeActive(input: {
  month: number;
  day: number;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}): boolean {
  const current = monthDayKey(input.month, input.day);
  const start = monthDayKey(input.startMonth, input.startDay);
  const end = monthDayKey(input.endMonth, input.endDay);
  if (start <= end) {
    return current >= start && current <= end;
  }
  // Cross-year range (e.g. Nov -> Feb)
  return current >= start || current <= end;
}

function monthToPrimarySeason(month: number): TownPrimarySeason {
  if (month === 12 || month <= 2) return "winter";
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  return "fall";
}

function baseAutoTags(input: { month: number; day: number }): TownSeasonKey[] {
  const tags = new Set<TownSeasonKey>();
  tags.add(monthToPrimarySeason(input.month));
  if (isMonthDayRangeActive({ month: input.month, day: input.day, startMonth: 11, startDay: 15, endMonth: 12, endDay: 31 })) {
    tags.add("holiday");
  }
  if (isMonthDayRangeActive({ month: input.month, day: input.day, startMonth: 8, startDay: 1, endMonth: 5, endDay: 25 })) {
    tags.add("school");
  }
  if (isMonthDayRangeActive({ month: input.month, day: input.day, startMonth: 8, startDay: 15, endMonth: 11, endDay: 30 })) {
    tags.add("football");
  }
  return [...tags];
}

function normalizeSeasonTags(tags: Iterable<TownSeasonKey>): TownSeasonKey[] {
  const set = new Set<TownSeasonKey>(tags);
  return SEASON_TAG_ORDER.filter((key) => set.has(key));
}

export function parseSeasonOverride(raw: unknown): TownSeasonKey | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = townSeasonKeySchema.safeParse(raw.trim().toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

export function detectTownSeasonState(input: {
  timezone: string;
  now?: Date;
  overrideSeason?: TownSeasonKey;
  customSeasons?: SeasonRowLike[];
}): DetectedTownSeason {
  const timezone = timezoneOrDefault(input.timezone);
  const parts = getTimezoneParts(input.now ?? new Date(), timezone);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  const primarySeason = monthToPrimarySeason(parts.month);
  const autoTags = new Set<TownSeasonKey>(baseAutoTags({ month: parts.month, day: parts.day }));

  const manualInactive = new Set<TownSeasonKey>();
  const seasonNotes: Partial<Record<TownSeasonKey, string>> = {};
  for (const row of input.customSeasons ?? []) {
    const isActive = isDateWithinAbsoluteRange({
      current: localDate,
      startDate: row.startDate,
      endDate: row.endDate,
    });
    if (isActive) {
      autoTags.add(row.seasonKey);
      if (row.notes && row.notes.trim() !== "") {
        seasonNotes[row.seasonKey] = row.notes.trim();
      }
    } else {
      manualInactive.add(row.seasonKey);
    }
  }

  for (const tag of manualInactive) {
    autoTags.delete(tag);
  }

  let resolvedPrimary = primarySeason;
  const override = input.overrideSeason;
  if (override) {
    autoTags.add(override);
    const maybePrimary = townPrimarySeasonSchema.safeParse(override);
    if (maybePrimary.success) {
      resolvedPrimary = maybePrimary.data;
    }
  }

  return detectedTownSeasonSchema.parse({
    primarySeason: resolvedPrimary,
    seasonTags: normalizeSeasonTags(autoTags),
    seasonNotes,
  });
}
