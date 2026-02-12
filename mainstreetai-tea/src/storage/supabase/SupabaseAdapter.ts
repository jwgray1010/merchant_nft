import { historyRecordSchema, type HistoryRecord } from "../../schemas/historySchema";
import { localEventsSchema, localEventsUpsertSchema, type LocalEvents, type LocalEventsUpsert } from "../../schemas/localEventsSchema";
import { metricsRequestSchema, storedMetricsSchema, type MetricsRequest, type StoredMetrics } from "../../schemas/metricsSchema";
import { postRequestSchema, storedPostSchema, type PostRequest, type StoredPost } from "../../schemas/postSchema";
import {
  scheduleCreateRequestSchema,
  scheduleItemSchema,
  scheduleUpdateRequestSchema,
  type ScheduleCreateRequest,
  type ScheduleItem,
  type ScheduleUpdateRequest,
} from "../../schemas/scheduleSchema";
import { getSupabaseAdminClient } from "../../supabase/supabaseAdmin";
import { brandProfileSchema, type BrandProfile } from "../../schemas/brandSchema";
import type { HistoryEndpoint, StorageAdapter } from "../StorageAdapter";

type BrandRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  business_name: string;
  location: string;
  type: string;
  voice: string;
  audiences: unknown;
  products_or_services: unknown;
  hours: string;
  typical_rush_times: string;
  slow_hours: string;
  offers_we_can_use: unknown;
  constraints: unknown;
  created_at: string;
  updated_at: string;
};

type HistoryRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  endpoint: string;
  request: unknown;
  response: unknown;
  created_at: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function isUuid(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toBrandProfile(row: BrandRow): BrandProfile {
  return brandProfileSchema.parse({
    brandId: row.brand_id,
    businessName: row.business_name,
    location: row.location,
    type: row.type,
    voice: row.voice,
    audiences: Array.isArray(row.audiences) ? row.audiences : [],
    productsOrServices: Array.isArray(row.products_or_services) ? row.products_or_services : [],
    hours: row.hours,
    typicalRushTimes: row.typical_rush_times,
    slowHours: row.slow_hours,
    offersWeCanUse: Array.isArray(row.offers_we_can_use) ? row.offers_we_can_use : [],
    constraints:
      typeof row.constraints === "object" && row.constraints !== null ? row.constraints : {},
  });
}

function toHistoryRecord(brandId: string, row: HistoryRow): HistoryRecord {
  return historyRecordSchema.parse({
    id: row.id,
    brandId,
    endpoint: row.endpoint,
    createdAt: row.created_at,
    request: row.request,
    response: row.response,
  });
}

export class SupabaseAdapter implements StorageAdapter {
  private readonly client = getSupabaseAdminClient();

  private async getBrandRow(userId: string, brandId: string): Promise<BrandRow | null> {
    const { data, error } = await this.client
      .from("brands")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return (data as BrandRow | null) ?? null;
  }

  private async requireBrandRow(userId: string, brandId: string): Promise<BrandRow> {
    const row = await this.getBrandRow(userId, brandId);
    if (!row) {
      throw new Error(`Brand '${brandId}' was not found`);
    }
    return row;
  }

  async listBrands(userId: string): Promise<BrandProfile[]> {
    const { data, error } = await this.client
      .from("brands")
      .select("*")
      .eq("owner_id", userId)
      .order("business_name", { ascending: true });
    if (error) {
      throw error;
    }
    return ((data ?? []) as BrandRow[]).map(toBrandProfile);
  }

  async getBrand(userId: string, brandId: string): Promise<BrandProfile | null> {
    const row = await this.getBrandRow(userId, brandId);
    return row ? toBrandProfile(row) : null;
  }

  async createBrand(userId: string, brand: BrandProfile): Promise<BrandProfile | null> {
    const parsed = brandProfileSchema.parse(brand);
    const payload = {
      owner_id: userId,
      brand_id: parsed.brandId,
      business_name: parsed.businessName,
      location: parsed.location,
      type: parsed.type,
      voice: parsed.voice,
      audiences: parsed.audiences,
      products_or_services: parsed.productsOrServices,
      hours: parsed.hours,
      typical_rush_times: parsed.typicalRushTimes,
      slow_hours: parsed.slowHours,
      offers_we_can_use: parsed.offersWeCanUse,
      constraints: parsed.constraints,
    };

    const { data, error } = await this.client.from("brands").insert(payload).select("*").single();
    if (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
    return toBrandProfile(data as BrandRow);
  }

  async updateBrand(
    userId: string,
    brandId: string,
    patch: Partial<BrandProfile> | BrandProfile,
  ): Promise<BrandProfile | null> {
    const existing = await this.getBrandRow(userId, brandId);
    if (!existing) {
      return null;
    }

    const merged = brandProfileSchema.parse({
      ...toBrandProfile(existing),
      ...patch,
      brandId,
    });

    const updatePayload = {
      business_name: merged.businessName,
      location: merged.location,
      type: merged.type,
      voice: merged.voice,
      audiences: merged.audiences,
      products_or_services: merged.productsOrServices,
      hours: merged.hours,
      typical_rush_times: merged.typicalRushTimes,
      slow_hours: merged.slowHours,
      offers_we_can_use: merged.offersWeCanUse,
      constraints: merged.constraints,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from("brands")
      .update(updatePayload)
      .eq("owner_id", userId)
      .eq("brand_id", brandId)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toBrandProfile(data as BrandRow);
  }

  async deleteBrand(userId: string, brandId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("brands")
      .delete()
      .eq("owner_id", userId)
      .eq("brand_id", brandId)
      .select("id")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return Boolean(data);
  }

  async addHistory(
    userId: string,
    brandId: string,
    endpoint: HistoryEndpoint,
    request: unknown,
    response: unknown,
    _tags?: string[],
  ): Promise<HistoryRecord> {
    const brandRow = await this.requireBrandRow(userId, brandId);

    const { data, error } = await this.client
      .from("history")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        endpoint,
        request,
        response,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toHistoryRecord(brandId, data as HistoryRow);
  }

  async listHistory(userId: string, brandId: string, limit: number): Promise<HistoryRecord[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);

    const { data, error } = await this.client
      .from("history")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }
    return ((data ?? []) as HistoryRow[]).map((row) => toHistoryRecord(brandId, row));
  }

  async getHistoryById(userId: string, brandId: string, id: string): Promise<HistoryRecord | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.client
      .from("history")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toHistoryRecord(brandId, data as HistoryRow);
  }

  async addPost(userId: string, brandId: string, post: PostRequest): Promise<StoredPost> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = postRequestSchema.parse(post);
    const postedAt = new Date(parsed.postedAt).toISOString();

    const { data, error } = await this.client
      .from("posts")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        platform: parsed.platform,
        posted_at: postedAt,
        media_type: parsed.mediaType,
        caption_used: parsed.captionUsed,
        promo_name: parsed.promoName ?? null,
        notes: parsed.notes ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }

    const row = data as {
      id: string;
      platform: string;
      posted_at: string;
      media_type: string;
      caption_used: string;
      promo_name: string | null;
      notes: string | null;
      created_at: string;
    };
    return storedPostSchema.parse({
      id: row.id,
      brandId,
      createdAt: row.created_at,
      platform: row.platform,
      postedAt: row.posted_at,
      mediaType: row.media_type,
      captionUsed: row.caption_used,
      promoName: row.promo_name ?? undefined,
      notes: row.notes ?? undefined,
    });
  }

  async listPosts(userId: string, brandId: string, limit: number): Promise<StoredPost[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.client
      .from("posts")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      storedPostSchema.parse({
        id: row.id,
        brandId,
        createdAt: row.created_at,
        platform: row.platform,
        postedAt: row.posted_at,
        mediaType: row.media_type,
        captionUsed: row.caption_used,
        promoName: row.promo_name ?? undefined,
        notes: row.notes ?? undefined,
      }),
    );
  }

  async addMetrics(userId: string, brandId: string, metrics: MetricsRequest): Promise<StoredMetrics> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = metricsRequestSchema.parse(metrics);
    const postRef = isUuid(parsed.postId) ? parsed.postId : null;

    const { data, error } = await this.client
      .from("metrics")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        platform: parsed.platform,
        post_ref: postRef,
        window: parsed.window,
        views: parsed.views ?? null,
        likes: parsed.likes ?? null,
        comments: parsed.comments ?? null,
        shares: parsed.shares ?? null,
        saves: parsed.saves ?? null,
        clicks: parsed.clicks ?? null,
        redemptions: parsed.redemptions ?? null,
        sales_notes: parsed.salesNotes ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }

    const row = data as Record<string, unknown>;
    return storedMetricsSchema.parse({
      id: row.id,
      brandId,
      createdAt: row.created_at,
      platform: row.platform,
      postId: row.post_ref ?? undefined,
      window: row.window,
      views: row.views ?? undefined,
      likes: row.likes ?? undefined,
      comments: row.comments ?? undefined,
      shares: row.shares ?? undefined,
      saves: row.saves ?? undefined,
      clicks: row.clicks ?? undefined,
      redemptions: row.redemptions ?? undefined,
      salesNotes: row.sales_notes ?? undefined,
    });
  }

  async listMetrics(userId: string, brandId: string, limit: number): Promise<StoredMetrics[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.client
      .from("metrics")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      storedMetricsSchema.parse({
        id: row.id,
        brandId,
        createdAt: row.created_at,
        platform: row.platform,
        postId: row.post_ref ?? undefined,
        window: row.window,
        views: row.views ?? undefined,
        likes: row.likes ?? undefined,
        comments: row.comments ?? undefined,
        shares: row.shares ?? undefined,
        saves: row.saves ?? undefined,
        clicks: row.clicks ?? undefined,
        redemptions: row.redemptions ?? undefined,
        salesNotes: row.sales_notes ?? undefined,
      }),
    );
  }

  async addScheduleItem(
    userId: string,
    brandId: string,
    item: ScheduleCreateRequest,
  ): Promise<ScheduleItem> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = scheduleCreateRequestSchema.parse(item);

    const { data, error } = await this.client
      .from("schedule")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        title: parsed.title,
        platform: parsed.platform,
        scheduled_for: new Date(parsed.scheduledFor).toISOString(),
        caption: parsed.caption,
        asset_notes: parsed.assetNotes,
        status: parsed.status,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }

    const row = data as Record<string, unknown>;
    return scheduleItemSchema.parse({
      id: row.id,
      brandId,
      title: row.title,
      platform: row.platform,
      scheduledFor: row.scheduled_for,
      caption: row.caption,
      assetNotes: row.asset_notes,
      status: row.status,
      createdAt: row.created_at,
    });
  }

  async listSchedule(
    userId: string,
    brandId: string,
    options?: { from?: string; to?: string },
  ): Promise<ScheduleItem[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    let query = this.client
      .from("schedule")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("scheduled_for", { ascending: true });

    if (options?.from) {
      query = query.gte("scheduled_for", new Date(options.from).toISOString());
    }
    if (options?.to) {
      query = query.lte("scheduled_for", new Date(options.to).toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      scheduleItemSchema.parse({
        id: row.id,
        brandId,
        title: row.title,
        platform: row.platform,
        scheduledFor: row.scheduled_for,
        caption: row.caption,
        assetNotes: row.asset_notes,
        status: row.status,
        createdAt: row.created_at,
      }),
    );
  }

  async updateSchedule(
    userId: string,
    brandId: string,
    scheduleId: string,
    updates: ScheduleUpdateRequest,
  ): Promise<ScheduleItem | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = scheduleUpdateRequestSchema.parse(updates);
    const payload: Record<string, unknown> = {};
    if (parsed.title !== undefined) payload.title = parsed.title;
    if (parsed.platform !== undefined) payload.platform = parsed.platform;
    if (parsed.scheduledFor !== undefined) {
      payload.scheduled_for = new Date(parsed.scheduledFor).toISOString();
    }
    if (parsed.caption !== undefined) payload.caption = parsed.caption;
    if (parsed.assetNotes !== undefined) payload.asset_notes = parsed.assetNotes;
    if (parsed.status !== undefined) payload.status = parsed.status;

    const { data, error } = await this.client
      .from("schedule")
      .update(payload)
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", scheduleId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const row = data as Record<string, unknown>;
    return scheduleItemSchema.parse({
      id: row.id,
      brandId,
      title: row.title,
      platform: row.platform,
      scheduledFor: row.scheduled_for,
      caption: row.caption,
      assetNotes: row.asset_notes,
      status: row.status,
      createdAt: row.created_at,
    });
  }

  async deleteSchedule(userId: string, brandId: string, scheduleId: string): Promise<boolean> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.client
      .from("schedule")
      .delete()
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", scheduleId)
      .select("id")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return Boolean(data);
  }

  async listLocalEvents(userId: string, brandId: string): Promise<LocalEvents> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.client
      .from("local_events")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false });
    if (error) {
      throw error;
    }

    const recurring = (data ?? [])
      .filter((row) => row.kind === "recurring")
      .map((row) => ({
        eventId: row.id as string,
        name: row.name as string,
        pattern: (row.pattern as string) ?? "",
        audience: (row.audience as string) ?? "",
        notes: (row.notes as string) ?? "",
      }));
    const oneOff = (data ?? [])
      .filter((row) => row.kind === "oneoff")
      .map((row) => ({
        eventId: row.id as string,
        name: row.name as string,
        date: (row.event_date as string) ?? "",
        time: (row.event_time as string) ?? "",
        audience: (row.audience as string) ?? "",
        notes: (row.notes as string) ?? "",
      }));

    return localEventsSchema.parse({ recurring, oneOff });
  }

  async upsertLocalEvents(
    userId: string,
    brandId: string,
    payload: LocalEventsUpsert,
  ): Promise<LocalEvents> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = localEventsUpsertSchema.parse(payload);

    if (parsed.mode === "replace") {
      const { error: deleteError } = await this.client
        .from("local_events")
        .delete()
        .eq("owner_id", userId)
        .eq("brand_ref", brandRow.id);
      if (deleteError) {
        throw deleteError;
      }
    }

    const inserts: Array<Record<string, unknown>> = [];
    for (const event of parsed.recurring ?? []) {
      inserts.push({
        owner_id: userId,
        brand_ref: brandRow.id,
        kind: "recurring",
        name: event.name,
        pattern: event.pattern,
        event_date: null,
        event_time: null,
        audience: event.audience,
        notes: event.notes,
      });
    }
    for (const event of parsed.oneOff ?? []) {
      inserts.push({
        owner_id: userId,
        brand_ref: brandRow.id,
        kind: "oneoff",
        name: event.name,
        pattern: null,
        event_date: event.date,
        event_time: event.time,
        audience: event.audience,
        notes: event.notes,
      });
    }

    if (inserts.length > 0) {
      const { error } = await this.client.from("local_events").insert(inserts);
      if (error) {
        throw error;
      }
    }

    return this.listLocalEvents(userId, brandId);
  }

  async deleteLocalEvent(userId: string, brandId: string, eventId: string): Promise<boolean> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.client
      .from("local_events")
      .delete()
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", eventId)
      .select("id")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return Boolean(data);
  }
}
