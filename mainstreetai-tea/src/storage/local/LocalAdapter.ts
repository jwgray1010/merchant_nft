import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { brandProfileSchema, type BrandProfile } from "../../schemas/brandSchema";
import { historyRecordSchema, type HistoryRecord } from "../../schemas/historySchema";
import {
  integrationRecordSchema,
  type IntegrationProvider,
  type IntegrationRecord,
  type IntegrationStatus,
} from "../../schemas/integrationSchema";
import {
  localEventsSchema,
  localEventsUpsertSchema,
  type LocalEvents,
  type LocalEventsUpsert,
} from "../../schemas/localEventsSchema";
import { metricsRequestSchema, storedMetricsSchema, type MetricsRequest, type StoredMetrics } from "../../schemas/metricsSchema";
import {
  outboxRecordSchema,
  outboxUpdateSchema,
  type OutboxRecord,
  type OutboxType,
  type OutboxUpdate,
} from "../../schemas/outboxSchema";
import { postRequestSchema, storedPostSchema, type PostRequest, type StoredPost } from "../../schemas/postSchema";
import {
  smsContactSchema,
  smsContactUpdateSchema,
  smsContactUpsertSchema,
  type SmsContact,
  type SmsContactUpdate,
  type SmsContactUpsert,
} from "../../schemas/smsContactSchema";
import {
  smsMessageCreateSchema,
  smsMessageSchema,
  smsMessageUpdateSchema,
  type SmsMessage,
  type SmsMessageCreate,
  type SmsMessageUpdate,
} from "../../schemas/smsSendSchema";
import {
  scheduleCreateRequestSchema,
  scheduleItemSchema,
  scheduleUpdateRequestSchema,
  type ScheduleCreateRequest,
  type ScheduleItem,
  type ScheduleUpdateRequest,
} from "../../schemas/scheduleSchema";
import { normalizeUSPhone } from "../../utils/phone";
import type { HistoryEndpoint, StorageAdapter } from "../StorageAdapter";

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export class LocalAdapter implements StorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir = path.resolve(process.cwd(), "data", "local_mode")) {
    this.rootDir = rootDir;
  }

  private userDir(userId: string): string {
    return path.join(this.rootDir, safePathSegment(userId));
  }

  private brandsDir(userId: string): string {
    return path.join(this.userDir(userId), "brands");
  }

  private brandPath(userId: string, brandId: string): string {
    return path.join(this.brandsDir(userId), `${brandId}.json`);
  }

  private historyDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "history", brandId);
  }

  private postsDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "posts", brandId);
  }

  private metricsDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "metrics", brandId);
  }

  private scheduleDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "schedule", brandId);
  }

  private localEventsPath(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "local_events", `${brandId}.json`);
  }

  private integrationsDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "integrations", brandId);
  }

  private integrationPath(userId: string, brandId: string, provider: IntegrationProvider): string {
    return path.join(this.integrationsDir(userId, brandId), `${provider}.json`);
  }

  private outboxDir(userId: string): string {
    return path.join(this.userDir(userId), "outbox");
  }

  private outboxPath(userId: string, outboxId: string): string {
    return path.join(this.outboxDir(userId), `${outboxId}.json`);
  }

  private smsContactsDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "sms_contacts", brandId);
  }

  private smsContactPath(userId: string, brandId: string, contactId: string): string {
    return path.join(this.smsContactsDir(userId, brandId), `${contactId}.json`);
  }

  private smsMessagesDir(userId: string, brandId: string): string {
    return path.join(this.userDir(userId), "sms_messages", brandId);
  }

  private smsMessagePath(userId: string, brandId: string, messageId: string): string {
    return path.join(this.smsMessagesDir(userId, brandId), `${messageId}.json`);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async listUserDirectories(): Promise<string[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  private async findOutboxFileById(id: string): Promise<string | null> {
    const userDirs = await this.listUserDirectories();
    for (const userDirName of userDirs) {
      const candidatePath = path.join(this.rootDir, userDirName, "outbox", `${id}.json`);
      const parsed = await this.readJson<unknown>(candidatePath);
      if (parsed) {
        return candidatePath;
      }
    }
    return null;
  }

  async listBrands(userId: string): Promise<BrandProfile[]> {
    const dir = this.brandsDir(userId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const brands = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return brandProfileSchema.parse(JSON.parse(raw));
        }),
    );

    return brands.sort((a, b) => a.businessName.localeCompare(b.businessName));
  }

  async getBrand(userId: string, brandId: string): Promise<BrandProfile | null> {
    const raw = await this.readJson<unknown>(this.brandPath(userId, brandId));
    if (!raw) {
      return null;
    }
    return brandProfileSchema.parse(raw);
  }

  async createBrand(userId: string, brand: BrandProfile): Promise<BrandProfile | null> {
    await this.ensureDir(this.brandsDir(userId));
    const existing = await this.getBrand(userId, brand.brandId);
    if (existing) {
      return null;
    }
    const normalized = brandProfileSchema.parse(brand);
    await this.atomicWriteJson(this.brandPath(userId, normalized.brandId), normalized);
    return normalized;
  }

  async updateBrand(
    userId: string,
    brandId: string,
    patch: Partial<BrandProfile> | BrandProfile,
  ): Promise<BrandProfile | null> {
    const existing = await this.getBrand(userId, brandId);
    if (!existing) {
      return null;
    }

    const merged = brandProfileSchema.parse({
      ...existing,
      ...patch,
      brandId,
    });
    await this.atomicWriteJson(this.brandPath(userId, brandId), merged);
    return merged;
  }

  async deleteBrand(userId: string, brandId: string): Promise<boolean> {
    try {
      await rm(this.brandPath(userId, brandId));
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }

    await Promise.allSettled([
      rm(this.historyDir(userId, brandId), { recursive: true, force: true }),
      rm(this.postsDir(userId, brandId), { recursive: true, force: true }),
      rm(this.metricsDir(userId, brandId), { recursive: true, force: true }),
      rm(this.scheduleDir(userId, brandId), { recursive: true, force: true }),
      rm(this.localEventsPath(userId, brandId), { force: true }),
      rm(this.integrationsDir(userId, brandId), { recursive: true, force: true }),
      rm(this.smsContactsDir(userId, brandId), { recursive: true, force: true }),
      rm(this.smsMessagesDir(userId, brandId), { recursive: true, force: true }),
    ]);

    const outboxRecords = await this.listOutbox(userId, brandId, 1000);
    await Promise.allSettled(
      outboxRecords.map((record) => rm(this.outboxPath(userId, record.id), { force: true })),
    );
    return true;
  }

  async addHistory(
    userId: string,
    brandId: string,
    endpoint: HistoryEndpoint,
    request: unknown,
    response: unknown,
    tags?: string[],
  ): Promise<HistoryRecord> {
    const createdAt = new Date().toISOString();
    const record = historyRecordSchema.parse({
      id: randomUUID(),
      brandId,
      endpoint,
      createdAt,
      request,
      response,
      ...(tags && tags.length > 0 ? { tags } : {}),
    });

    const dir = this.historyDir(userId, brandId);
    await this.ensureDir(dir);
    await this.atomicWriteJson(path.join(dir, `${record.id}.json`), record);
    return record;
  }

  async listHistory(userId: string, brandId: string, limit: number): Promise<HistoryRecord[]> {
    const dir = this.historyDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const items = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return historyRecordSchema.parse(JSON.parse(raw));
        }),
    );

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(0, limit));
  }

  async getHistoryById(userId: string, brandId: string, id: string): Promise<HistoryRecord | null> {
    const raw = await this.readJson<unknown>(path.join(this.historyDir(userId, brandId), `${id}.json`));
    if (!raw) {
      return null;
    }
    return historyRecordSchema.parse(raw);
  }

  async addPost(userId: string, brandId: string, post: PostRequest): Promise<StoredPost> {
    const parsed = postRequestSchema.parse(post);
    const createdAt = new Date().toISOString();
    const record = storedPostSchema.parse({
      id: randomUUID(),
      brandId,
      createdAt,
      ...parsed,
      postedAt: new Date(parsed.postedAt).toISOString(),
    });

    const dir = this.postsDir(userId, brandId);
    await this.ensureDir(dir);
    await this.atomicWriteJson(path.join(dir, `${record.id}.json`), record);
    return record;
  }

  async listPosts(userId: string, brandId: string, limit: number): Promise<StoredPost[]> {
    const dir = this.postsDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const posts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return storedPostSchema.parse(JSON.parse(raw));
        }),
    );

    return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(0, limit));
  }

  async addMetrics(userId: string, brandId: string, metrics: MetricsRequest): Promise<StoredMetrics> {
    const parsed = metricsRequestSchema.parse(metrics);
    const createdAt = new Date().toISOString();
    const record = storedMetricsSchema.parse({
      id: randomUUID(),
      brandId,
      createdAt,
      ...parsed,
    });

    const dir = this.metricsDir(userId, brandId);
    await this.ensureDir(dir);
    await this.atomicWriteJson(path.join(dir, `${record.id}.json`), record);
    return record;
  }

  async listMetrics(userId: string, brandId: string, limit: number): Promise<StoredMetrics[]> {
    const dir = this.metricsDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const items = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return storedMetricsSchema.parse(JSON.parse(raw));
        }),
    );

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(0, limit));
  }

  async addScheduleItem(
    userId: string,
    brandId: string,
    item: ScheduleCreateRequest,
  ): Promise<ScheduleItem> {
    const parsed = scheduleCreateRequestSchema.parse(item);
    const createdAt = new Date().toISOString();
    const record = scheduleItemSchema.parse({
      id: randomUUID(),
      brandId,
      createdAt,
      ...parsed,
      scheduledFor: new Date(parsed.scheduledFor).toISOString(),
    });

    const dir = this.scheduleDir(userId, brandId);
    await this.ensureDir(dir);
    await this.atomicWriteJson(path.join(dir, `${record.id}.json`), record);
    return record;
  }

  async listSchedule(
    userId: string,
    brandId: string,
    options?: { from?: string; to?: string },
  ): Promise<ScheduleItem[]> {
    const dir = this.scheduleDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
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
          const raw = await readFile(path.join(dir, entry), "utf8");
          return scheduleItemSchema.parse(JSON.parse(raw));
        }),
    );

    return items
      .filter((item) => {
        const ms = new Date(item.scheduledFor).getTime();
        if (!Number.isFinite(ms)) {
          return false;
        }
        if (fromMs !== null && Number.isFinite(fromMs) && ms < fromMs) {
          return false;
        }
        if (toMs !== null && Number.isFinite(toMs) && ms > toMs) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  async updateSchedule(
    userId: string,
    brandId: string,
    scheduleId: string,
    updates: ScheduleUpdateRequest,
  ): Promise<ScheduleItem | null> {
    const parsedUpdates = scheduleUpdateRequestSchema.parse(updates);
    const filePath = path.join(this.scheduleDir(userId, brandId), `${scheduleId}.json`);
    const existing = await this.readJson<unknown>(filePath);
    if (!existing) {
      return null;
    }
    const existingParsed = scheduleItemSchema.parse(existing);
    const merged = scheduleItemSchema.parse({
      ...existingParsed,
      ...parsedUpdates,
      scheduledFor: parsedUpdates.scheduledFor
        ? new Date(parsedUpdates.scheduledFor).toISOString()
        : existingParsed.scheduledFor,
    });
    await this.atomicWriteJson(filePath, merged);
    return merged;
  }

  async deleteSchedule(userId: string, brandId: string, scheduleId: string): Promise<boolean> {
    try {
      await rm(path.join(this.scheduleDir(userId, brandId), `${scheduleId}.json`));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private async normalizeLocalEvents(
    userId: string,
    brandId: string,
  ): Promise<LocalEvents> {
    const raw = await this.readJson<unknown>(this.localEventsPath(userId, brandId));
    if (!raw) {
      return localEventsSchema.parse({ recurring: [], oneOff: [] });
    }

    const parsed = localEventsSchema.safeParse(raw);
    if (parsed.success) {
      const normalized = {
        recurring: parsed.data.recurring.map((event) => ({
          ...event,
          eventId: event.eventId || randomUUID(),
        })),
        oneOff: parsed.data.oneOff.map((event) => ({
          ...event,
          eventId: event.eventId || randomUUID(),
        })),
      };
      return localEventsSchema.parse(normalized);
    }

    return localEventsSchema.parse({ recurring: [], oneOff: [] });
  }

  async listLocalEvents(userId: string, brandId: string): Promise<LocalEvents> {
    return this.normalizeLocalEvents(userId, brandId);
  }

  async upsertLocalEvents(
    userId: string,
    brandId: string,
    payload: LocalEventsUpsert,
  ): Promise<LocalEvents> {
    const parsedPayload = localEventsUpsertSchema.parse(payload);
    const existing = await this.normalizeLocalEvents(userId, brandId);

    const incomingRecurring = (parsedPayload.recurring ?? []).map((event) => ({
      eventId: event.eventId?.trim() || randomUUID(),
      name: event.name.trim(),
      pattern: event.pattern.trim(),
      audience: event.audience.trim(),
      notes: event.notes.trim(),
    }));
    const incomingOneOff = (parsedPayload.oneOff ?? []).map((event) => ({
      eventId: event.eventId?.trim() || randomUUID(),
      name: event.name.trim(),
      date: event.date,
      time: event.time.trim(),
      audience: event.audience.trim(),
      notes: event.notes.trim(),
    }));

    const next =
      parsedPayload.mode === "append"
        ? localEventsSchema.parse({
            recurring: [...existing.recurring, ...incomingRecurring],
            oneOff: [...existing.oneOff, ...incomingOneOff],
          })
        : localEventsSchema.parse({
            recurring: incomingRecurring,
            oneOff: incomingOneOff,
          });

    const targetDir = path.dirname(this.localEventsPath(userId, brandId));
    await this.ensureDir(targetDir);
    await this.atomicWriteJson(this.localEventsPath(userId, brandId), next);
    return next;
  }

  async deleteLocalEvent(userId: string, brandId: string, eventId: string): Promise<boolean> {
    const existing = await this.normalizeLocalEvents(userId, brandId);
    const filteredRecurring = existing.recurring.filter((event) => event.eventId !== eventId);
    const filteredOneOff = existing.oneOff.filter((event) => event.eventId !== eventId);

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
    const targetDir = path.dirname(this.localEventsPath(userId, brandId));
    await this.ensureDir(targetDir);
    await this.atomicWriteJson(this.localEventsPath(userId, brandId), next);
    return true;
  }

  async upsertIntegration(
    userId: string,
    brandId: string,
    provider: IntegrationProvider,
    status: IntegrationStatus,
    config: Record<string, unknown>,
    secretsEnc?: string | null,
  ): Promise<IntegrationRecord> {
    const filePath = this.integrationPath(userId, brandId, provider);
    const existing = await this.readJson<unknown>(filePath);
    const existingParsed = integrationRecordSchema.safeParse(existing);
    const nowIso = new Date().toISOString();

    const next = integrationRecordSchema.parse({
      id: existingParsed.success ? existingParsed.data.id : randomUUID(),
      ownerId: userId,
      brandId,
      provider,
      status,
      config,
      secretsEnc: secretsEnc ?? (existingParsed.success ? existingParsed.data.secretsEnc ?? null : null),
      createdAt: existingParsed.success ? existingParsed.data.createdAt : nowIso,
      updatedAt: nowIso,
    });

    await this.ensureDir(this.integrationsDir(userId, brandId));
    await this.atomicWriteJson(filePath, next);
    return next;
  }

  async getIntegration(
    userId: string,
    brandId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationRecord | null> {
    const raw = await this.readJson<unknown>(this.integrationPath(userId, brandId, provider));
    if (!raw) {
      return null;
    }
    const parsed = integrationRecordSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async listIntegrations(userId: string, brandId: string): Promise<IntegrationRecord[]> {
    const dir = this.integrationsDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const items = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return integrationRecordSchema.safeParse(JSON.parse(raw));
        }),
    );

    return items
      .filter((result): result is { success: true; data: IntegrationRecord } => result.success)
      .map((result) => result.data)
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }

  async enqueueOutbox(
    userId: string,
    brandId: string,
    type: OutboxType,
    payload: Record<string, unknown>,
    scheduledFor?: string | null,
  ): Promise<OutboxRecord> {
    const nowIso = new Date().toISOString();
    const record = outboxRecordSchema.parse({
      id: randomUUID(),
      ownerId: userId,
      brandId,
      type,
      payload,
      status: "queued",
      attempts: 0,
      lastError: undefined,
      scheduledFor: scheduledFor ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await this.ensureDir(this.outboxDir(userId));
    await this.atomicWriteJson(this.outboxPath(userId, record.id), record);
    return record;
  }

  async listOutbox(userId: string, brandId: string, limit: number): Promise<OutboxRecord[]> {
    const dir = this.outboxDir(userId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const items = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return outboxRecordSchema.safeParse(JSON.parse(raw));
        }),
    );

    return items
      .filter((result): result is { success: true; data: OutboxRecord } => result.success)
      .map((result) => result.data)
      .filter((record) => record.brandId === brandId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
  }

  async listDueOutbox(nowIso: string, limit: number): Promise<OutboxRecord[]> {
    const nowMs = new Date(nowIso).getTime();
    if (!Number.isFinite(nowMs)) {
      return [];
    }

    const userDirNames = await this.listUserDirectories();
    const allRecords: OutboxRecord[] = [];
    for (const userDirName of userDirNames) {
      const outboxDir = path.join(this.rootDir, userDirName, "outbox");
      let entries: string[];
      try {
        entries = await readdir(outboxDir);
      } catch (error) {
        if (isNotFound(error)) {
          continue;
        }
        throw error;
      }

      for (const entry of entries.filter((name) => name.endsWith(".json"))) {
        const raw = await readFile(path.join(outboxDir, entry), "utf8");
        const parsed = outboxRecordSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          continue;
        }
        const record = parsed.data;
        if (record.status !== "queued") {
          continue;
        }
        if (!record.scheduledFor) {
          allRecords.push(record);
          continue;
        }
        const scheduledMs = new Date(record.scheduledFor).getTime();
        if (Number.isFinite(scheduledMs) && scheduledMs <= nowMs) {
          allRecords.push(record);
        }
      }
    }

    return allRecords
      .sort((a, b) => {
        const aSort = a.scheduledFor ?? a.createdAt;
        const bSort = b.scheduledFor ?? b.createdAt;
        return aSort.localeCompare(bSort);
      })
      .slice(0, Math.max(0, limit));
  }

  async updateOutbox(id: string, updates: OutboxUpdate): Promise<OutboxRecord | null> {
    const parsedUpdates = outboxUpdateSchema.parse(updates);
    const filePath = await this.findOutboxFileById(id);
    if (!filePath) {
      return null;
    }

    const existing = await this.readJson<unknown>(filePath);
    if (!existing) {
      return null;
    }

    const parsedExisting = outboxRecordSchema.parse(existing);
    const merged = outboxRecordSchema.parse({
      ...parsedExisting,
      ...parsedUpdates,
      lastError:
        parsedUpdates.lastError === null
          ? undefined
          : parsedUpdates.lastError ?? parsedExisting.lastError,
      updatedAt: new Date().toISOString(),
    });

    await this.atomicWriteJson(filePath, merged);
    return merged;
  }

  async getOutboxById(userId: string, brandId: string, id: string): Promise<OutboxRecord | null> {
    const raw = await this.readJson<unknown>(this.outboxPath(userId, id));
    if (!raw) {
      return null;
    }
    const parsed = outboxRecordSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.brandId !== brandId) {
      return null;
    }
    return parsed.data;
  }

  async listSmsContacts(userId: string, brandId: string, limit: number): Promise<SmsContact[]> {
    const dir = this.smsContactsDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const contacts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return smsContactSchema.parse(JSON.parse(raw));
        }),
    );

    return contacts
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
  }

  async upsertSmsContact(userId: string, brandId: string, input: SmsContactUpsert): Promise<SmsContact> {
    const parsed = smsContactUpsertSchema.parse(input);
    const phone = normalizeUSPhone(parsed.phone);
    const nowIso = new Date().toISOString();

    const existing = (await this.listSmsContacts(userId, brandId, 5000)).find(
      (entry) => entry.phone === phone,
    );
    const record = smsContactSchema.parse({
      id: existing?.id ?? randomUUID(),
      ownerId: userId,
      brandId,
      phone,
      name: parsed.name?.trim() || undefined,
      tags: parsed.tags,
      optedIn: parsed.optedIn,
      consentSource: parsed.consentSource?.trim() || undefined,
      createdAt: existing?.createdAt ?? nowIso,
    });

    await this.ensureDir(this.smsContactsDir(userId, brandId));
    await this.atomicWriteJson(this.smsContactPath(userId, brandId, record.id), record);
    return record;
  }

  async updateSmsContact(
    userId: string,
    brandId: string,
    contactId: string,
    updates: SmsContactUpdate,
  ): Promise<SmsContact | null> {
    const parsedUpdates = smsContactUpdateSchema.parse(updates);
    const filePath = this.smsContactPath(userId, brandId, contactId);
    const existing = await this.readJson<unknown>(filePath);
    if (!existing) {
      return null;
    }
    const current = smsContactSchema.parse(existing);
    const next = smsContactSchema.parse({
      ...current,
      ...parsedUpdates,
      phone:
        parsedUpdates.phone !== undefined
          ? normalizeUSPhone(parsedUpdates.phone)
          : current.phone,
      name:
        parsedUpdates.name !== undefined ? parsedUpdates.name.trim() || undefined : current.name,
      consentSource:
        parsedUpdates.consentSource !== undefined
          ? parsedUpdates.consentSource.trim() || undefined
          : current.consentSource,
    });

    await this.atomicWriteJson(filePath, next);
    return next;
  }

  async deleteSmsContact(userId: string, brandId: string, contactId: string): Promise<boolean> {
    try {
      await rm(this.smsContactPath(userId, brandId, contactId));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async addSmsMessage(userId: string, brandId: string, input: SmsMessageCreate): Promise<SmsMessage> {
    const parsed = smsMessageCreateSchema.parse(input);
    const nowIso = new Date().toISOString();
    const record = smsMessageSchema.parse({
      id: randomUUID(),
      ownerId: userId,
      brandId,
      toPhone: normalizeUSPhone(parsed.toPhone),
      body: parsed.body,
      status: parsed.status,
      providerMessageId: parsed.providerMessageId,
      error: parsed.error,
      purpose: parsed.purpose,
      createdAt: nowIso,
      sentAt: parsed.sentAt,
    });

    await this.ensureDir(this.smsMessagesDir(userId, brandId));
    await this.atomicWriteJson(this.smsMessagePath(userId, brandId, record.id), record);
    return record;
  }

  async listSmsMessages(userId: string, brandId: string, limit: number): Promise<SmsMessage[]> {
    const dir = this.smsMessagesDir(userId, brandId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const items = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(dir, entry), "utf8");
          return smsMessageSchema.parse(JSON.parse(raw));
        }),
    );

    return items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
  }

  async updateSmsMessage(
    userId: string,
    brandId: string,
    messageId: string,
    updates: SmsMessageUpdate,
  ): Promise<SmsMessage | null> {
    const parsedUpdates = smsMessageUpdateSchema.parse(updates);
    const filePath = this.smsMessagePath(userId, brandId, messageId);
    const existing = await this.readJson<unknown>(filePath);
    if (!existing) {
      return null;
    }
    const current = smsMessageSchema.parse(existing);
    const next = smsMessageSchema.parse({
      ...current,
      ...parsedUpdates,
      error:
        parsedUpdates.error === null
          ? undefined
          : parsedUpdates.error ?? current.error,
    });
    await this.atomicWriteJson(filePath, next);
    return next;
  }
}
