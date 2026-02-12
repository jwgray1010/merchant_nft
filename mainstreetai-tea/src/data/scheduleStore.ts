import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  scheduleCreateRequestSchema,
  scheduleItemSchema,
  type ScheduleCreateRequest,
  type ScheduleItem,
  type ScheduleUpdateRequest,
} from "../schemas/scheduleSchema";

const SCHEDULE_DIR = path.resolve(process.cwd(), "data", "schedule");

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function brandScheduleDir(brandId: string): string {
  return path.join(SCHEDULE_DIR, brandId);
}

function scheduleFilePath(brandId: string, id: string): string {
  return path.join(brandScheduleDir(brandId), `${id}.json`);
}

async function ensureBrandDir(brandId: string): Promise<void> {
  await mkdir(brandScheduleDir(brandId), { recursive: true });
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readScheduleFile(brandId: string, id: string): Promise<ScheduleItem | null> {
  try {
    const raw = await readFile(scheduleFilePath(brandId, id), "utf8");
    return scheduleItemSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function createScheduleItem(
  brandId: string,
  payload: ScheduleCreateRequest,
): Promise<ScheduleItem> {
  await ensureBrandDir(brandId);

  const parsedPayload = scheduleCreateRequestSchema.parse(payload);
  const createdAt = new Date().toISOString();
  const item: ScheduleItem = scheduleItemSchema.parse({
    id: randomUUID(),
    brandId,
    title: parsedPayload.title,
    platform: parsedPayload.platform,
    scheduledFor: new Date(parsedPayload.scheduledFor).toISOString(),
    caption: parsedPayload.caption,
    assetNotes: parsedPayload.assetNotes,
    status: parsedPayload.status,
    createdAt,
  });

  await atomicWriteJson(scheduleFilePath(brandId, item.id), item);
  return item;
}

export async function listScheduleItems(
  brandId: string,
  options?: {
    from?: string;
    to?: string;
  },
): Promise<ScheduleItem[]> {
  const directory = brandScheduleDir(brandId);
  let entries: string[];

  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const fromMs = options?.from ? new Date(options.from).getTime() : null;
  const toMs = options?.to ? new Date(options.to).getTime() : null;

  const items = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const raw = await readFile(path.join(directory, entry), "utf8");
        return scheduleItemSchema.parse(JSON.parse(raw));
      }),
  );

  return items
    .filter((item) => {
      const scheduledMs = new Date(item.scheduledFor).getTime();
      if (!Number.isFinite(scheduledMs)) {
        return false;
      }
      if (fromMs !== null && Number.isFinite(fromMs) && scheduledMs < fromMs) {
        return false;
      }
      if (toMs !== null && Number.isFinite(toMs) && scheduledMs > toMs) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

export async function getScheduleItem(brandId: string, id: string): Promise<ScheduleItem | null> {
  return readScheduleFile(brandId, id);
}

export async function updateScheduleItem(
  brandId: string,
  id: string,
  updates: ScheduleUpdateRequest,
): Promise<ScheduleItem | null> {
  const existing = await readScheduleFile(brandId, id);
  if (!existing) {
    return null;
  }

  const updated = scheduleItemSchema.parse({
    ...existing,
    ...updates,
    scheduledFor: updates.scheduledFor
      ? new Date(updates.scheduledFor).toISOString()
      : existing.scheduledFor,
  });

  await atomicWriteJson(scheduleFilePath(brandId, id), updated);
  return updated;
}

export async function deleteScheduleItem(brandId: string, id: string): Promise<boolean> {
  try {
    await rm(scheduleFilePath(brandId, id));
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}
