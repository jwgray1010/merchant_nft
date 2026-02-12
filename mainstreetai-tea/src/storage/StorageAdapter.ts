import type { BrandProfile } from "../schemas/brandSchema";
import type { HistoryRecord } from "../schemas/historySchema";
import type { LocalEvents, LocalEventsUpsert } from "../schemas/localEventsSchema";
import type { MetricsRequest, StoredMetrics } from "../schemas/metricsSchema";
import type { PostRequest, StoredPost } from "../schemas/postSchema";
import type {
  ScheduleCreateRequest,
  ScheduleItem,
  ScheduleUpdateRequest,
} from "../schemas/scheduleSchema";

export type HistoryEndpoint = "promo" | "social" | "events" | "week-plan" | "next-week-plan";

export interface StorageAdapter {
  listBrands(userId: string): Promise<BrandProfile[]>;
  getBrand(userId: string, brandId: string): Promise<BrandProfile | null>;
  createBrand(userId: string, brand: BrandProfile): Promise<BrandProfile | null>;
  updateBrand(
    userId: string,
    brandId: string,
    patch: Partial<BrandProfile> | BrandProfile,
  ): Promise<BrandProfile | null>;
  deleteBrand(userId: string, brandId: string): Promise<boolean>;

  addHistory(
    userId: string,
    brandId: string,
    endpoint: HistoryEndpoint,
    request: unknown,
    response: unknown,
    tags?: string[],
  ): Promise<HistoryRecord>;
  listHistory(userId: string, brandId: string, limit: number): Promise<HistoryRecord[]>;
  getHistoryById(userId: string, brandId: string, id: string): Promise<HistoryRecord | null>;

  addPost(userId: string, brandId: string, post: PostRequest): Promise<StoredPost>;
  listPosts(userId: string, brandId: string, limit: number): Promise<StoredPost[]>;

  addMetrics(userId: string, brandId: string, metrics: MetricsRequest): Promise<StoredMetrics>;
  listMetrics(userId: string, brandId: string, limit: number): Promise<StoredMetrics[]>;

  addScheduleItem(
    userId: string,
    brandId: string,
    item: ScheduleCreateRequest,
  ): Promise<ScheduleItem>;
  listSchedule(
    userId: string,
    brandId: string,
    options?: { from?: string; to?: string },
  ): Promise<ScheduleItem[]>;
  updateSchedule(
    userId: string,
    brandId: string,
    scheduleId: string,
    updates: ScheduleUpdateRequest,
  ): Promise<ScheduleItem | null>;
  deleteSchedule(userId: string, brandId: string, scheduleId: string): Promise<boolean>;

  listLocalEvents(userId: string, brandId: string): Promise<LocalEvents>;
  upsertLocalEvents(
    userId: string,
    brandId: string,
    payload: LocalEventsUpsert,
  ): Promise<LocalEvents>;
  deleteLocalEvent(userId: string, brandId: string, eventId: string): Promise<boolean>;
}
