import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  localEventsSchema,
  localEventsUpsertSchema,
  type LocalEvents,
  type LocalEventsUpsert,
  type OneOffEvent,
  type RecurringEvent,
} from "../schemas/localEventsSchema";

const LOCAL_EVENTS_DIR = path.resolve(process.cwd(), "data", "local_events");

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function localEventsFilePath(brandId: string): string {
  return path.join(LOCAL_EVENTS_DIR, `${brandId}.json`);
}

async function ensureLocalEventsDir(): Promise<void> {
  await mkdir(LOCAL_EVENTS_DIR, { recursive: true });
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function normalizeRecurringEvent(event: {
  eventId?: string;
  name: string;
  pattern: string;
  audience: string;
  notes: string;
}): RecurringEvent {
  return {
    eventId: event.eventId?.trim() || randomUUID(),
    name: event.name.trim(),
    pattern: event.pattern.trim(),
    audience: event.audience.trim(),
    notes: event.notes.trim(),
  };
}

function normalizeOneOffEvent(event: {
  eventId?: string;
  name: string;
  date: string;
  time: string;
  audience: string;
  notes: string;
}): OneOffEvent {
  return {
    eventId: event.eventId?.trim() || randomUUID(),
    name: event.name.trim(),
    date: event.date,
    time: event.time.trim(),
    audience: event.audience.trim(),
    notes: event.notes.trim(),
  };
}

function normalizeLocalEvents(events: {
  recurring: Array<{
    eventId?: string;
    name: string;
    pattern: string;
    audience: string;
    notes: string;
  }>;
  oneOff: Array<{
    eventId?: string;
    name: string;
    date: string;
    time: string;
    audience: string;
    notes: string;
  }>;
}): LocalEvents {
  return localEventsSchema.parse({
    recurring: events.recurring.map(normalizeRecurringEvent),
    oneOff: events.oneOff.map(normalizeOneOffEvent),
  });
}

export async function getLocalEvents(brandId: string): Promise<LocalEvents> {
  await ensureLocalEventsDir();
  const filePath = localEventsFilePath(brandId);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = localEventsSchema.parse(JSON.parse(raw));
    const normalized = normalizeLocalEvents(parsed);

    // Backfill IDs if older files do not have them.
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await atomicWriteJson(filePath, normalized);
    }

    return normalized;
  } catch (error) {
    if (isNotFound(error)) {
      return localEventsSchema.parse({ recurring: [], oneOff: [] });
    }
    throw error;
  }
}

export async function upsertLocalEvents(
  brandId: string,
  payload: LocalEventsUpsert,
): Promise<LocalEvents> {
  const parsedPayload = localEventsUpsertSchema.parse(payload);
  const existing = await getLocalEvents(brandId);

  const incomingRecurring = (parsedPayload.recurring ?? []).map(normalizeRecurringEvent);
  const incomingOneOff = (parsedPayload.oneOff ?? []).map(normalizeOneOffEvent);

  const next: LocalEvents =
    parsedPayload.mode === "append"
      ? localEventsSchema.parse({
          recurring: [...existing.recurring, ...incomingRecurring],
          oneOff: [...existing.oneOff, ...incomingOneOff],
        })
      : localEventsSchema.parse({
          recurring: incomingRecurring,
          oneOff: incomingOneOff,
        });

  await ensureLocalEventsDir();
  await atomicWriteJson(localEventsFilePath(brandId), next);
  return next;
}

export async function deleteLocalEvent(brandId: string, eventId: string): Promise<boolean> {
  const existing = await getLocalEvents(brandId);
  const normalizedEventId = eventId.trim();
  if (!normalizedEventId) {
    return false;
  }

  const filteredRecurring = existing.recurring.filter((event) => event.eventId !== normalizedEventId);
  const filteredOneOff = existing.oneOff.filter((event) => event.eventId !== normalizedEventId);
  const changed =
    filteredRecurring.length !== existing.recurring.length ||
    filteredOneOff.length !== existing.oneOff.length;

  if (!changed) {
    return false;
  }

  const next = localEventsSchema.parse({
    recurring: filteredRecurring,
    oneOff: filteredOneOff,
  });
  await atomicWriteJson(localEventsFilePath(brandId), next);
  return true;
}

export async function clearLocalEvents(brandId: string): Promise<void> {
  try {
    await rm(localEventsFilePath(brandId));
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}
