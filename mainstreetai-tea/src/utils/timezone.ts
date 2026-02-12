type TimezoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekdayShort: string;
};

const DEFAULT_TIMEZONE = "America/Chicago";

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
}

export function timezoneOrDefault(input: string | undefined): string {
  const value = input?.trim();
  if (!value) {
    return DEFAULT_TIMEZONE;
  }
  try {
    formatter(value).format(new Date());
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function getTimezoneParts(date: Date, timeZone: string): TimezoneParts {
  const tz = timezoneOrDefault(timeZone);
  const parts = formatter(tz).formatToParts(date);
  const record = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(record.get("year") ?? "0"),
    month: Number(record.get("month") ?? "0"),
    day: Number(record.get("day") ?? "0"),
    hour: Number(record.get("hour") ?? "0"),
    minute: Number(record.get("minute") ?? "0"),
    second: Number(record.get("second") ?? "0"),
    weekdayShort: (record.get("weekday") ?? "").toLowerCase(),
  };
}

export function weekdayIndexFromShort(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("sun")) return 0;
  if (normalized.startsWith("mon")) return 1;
  if (normalized.startsWith("tue")) return 2;
  if (normalized.startsWith("wed")) return 3;
  if (normalized.startsWith("thu")) return 4;
  if (normalized.startsWith("fri")) return 5;
  if (normalized.startsWith("sat")) return 6;
  return -1;
}

export function dateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = getTimezoneParts(date, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function tomorrowDateInTimezone(timeZone: string, now = new Date()): string {
  const nowParts = getTimezoneParts(now, timeZone);
  const tomorrowUtc = new Date(
    Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1, 12, 0, 0),
  );
  return dateKeyInTimezone(tomorrowUtc, timeZone);
}

export function parsePostTimeToHourMinute(input: string): { hour: number; minute: number } | null {
  const value = input.trim().toLowerCase();
  const direct = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (direct) {
    return {
      hour: Number(direct[1]),
      minute: Number(direct[2]),
    };
  }

  const ampm = value.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)\b/);
  if (!ampm) {
    return null;
  }
  let hour = Number(ampm[1]);
  const minute = Number(ampm[2] ?? "0");
  const suffix = ampm[3];
  if (suffix === "am") {
    if (hour === 12) hour = 0;
  } else if (hour < 12) {
    hour += 12;
  }
  return { hour, minute };
}

export function zonedDateTimeToUtcIso(input: {
  date: string;
  hour: number;
  minute?: number;
  second?: number;
  timeZone: string;
}): string {
  const [yearRaw, monthRaw, dayRaw] = input.date.split("-").map((part) => Number(part));
  const year = Number.isFinite(yearRaw) ? yearRaw : 1970;
  const month = Number.isFinite(monthRaw) ? monthRaw : 1;
  const day = Number.isFinite(dayRaw) ? dayRaw : 1;
  const hour = Math.max(0, Math.min(23, input.hour));
  const minute = Math.max(0, Math.min(59, input.minute ?? 0));
  const second = Math.max(0, Math.min(59, input.second ?? 0));

  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const observed = getTimezoneParts(guessUtc, input.timeZone);
  const observedUtcMs = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second,
  );
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const correctionMs = targetUtcMs - observedUtcMs;
  return new Date(guessUtc.getTime() + correctionMs).toISOString();
}

export function nowMatchesLocalHour(
  now: Date,
  timeZone: string,
  expectedHour: number,
): { matches: boolean; weekdayIndex: number; dateKey: string } {
  const parts = getTimezoneParts(now, timeZone);
  return {
    matches: parts.hour === expectedHour,
    weekdayIndex: weekdayIndexFromShort(parts.weekdayShort),
    dateKey: `${parts.year.toString().padStart(4, "0")}-${parts.month
      .toString()
      .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`,
  };
}
