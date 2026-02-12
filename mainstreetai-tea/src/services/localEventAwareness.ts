import { getAdapter } from "../storage/getAdapter";

type UpcomingLocalEvent = {
  eventId: string;
  name: string;
  when: string;
  time: string;
  audience: string;
  notes: string;
  source: "oneOff" | "recurring";
};

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePatternWeekdays(pattern: string): number[] {
  const normalized = pattern.toLowerCase();
  const matches = new Set<number>();
  const tokens = normalized.split(/[^a-z]+/g).filter(Boolean);

  for (const token of tokens) {
    const day = WEEKDAY_ALIASES[token];
    if (typeof day === "number") {
      matches.add(day);
    }
  }

  return [...matches];
}

function addDays(base: Date, count: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + count);
  return next;
}

export async function getUpcomingLocalEvents(
  userId: string,
  brandId: string,
  daysAhead = 7,
): Promise<UpcomingLocalEvent[]> {
  const adapter = getAdapter();
  const events = await adapter.listLocalEvents(userId, brandId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = addDays(today, Math.max(0, daysAhead - 1));
  end.setHours(23, 59, 59, 999);

  const oneOff = events.oneOff
    .filter((event) => {
      const eventDate = new Date(`${event.date}T00:00:00`);
      return eventDate >= today && eventDate <= end;
    })
    .map(
      (event): UpcomingLocalEvent => ({
        eventId: event.eventId,
        name: event.name,
        when: event.date,
        time: event.time,
        audience: event.audience,
        notes: event.notes,
        source: "oneOff",
      }),
    );

  const recurring: UpcomingLocalEvent[] = [];
  for (const event of events.recurring) {
    const weekdays = parsePatternWeekdays(event.pattern);
    if (weekdays.length === 0) {
      recurring.push({
        eventId: event.eventId,
        name: event.name,
        when: `Recurring: ${event.pattern}`,
        time: "",
        audience: event.audience,
        notes: event.notes,
        source: "recurring",
      });
      continue;
    }

    for (let offset = 0; offset < daysAhead; offset += 1) {
      const candidate = addDays(today, offset);
      if (!weekdays.includes(candidate.getDay())) {
        continue;
      }
      recurring.push({
        eventId: event.eventId,
        name: event.name,
        when: `${dateKey(candidate)} (${event.pattern})`,
        time: "",
        audience: event.audience,
        notes: event.notes,
        source: "recurring",
      });
    }
  }

  return [...oneOff, ...recurring]
    .sort((a, b) => a.when.localeCompare(b.when))
    .slice(0, 20);
}

export type { UpcomingLocalEvent };
