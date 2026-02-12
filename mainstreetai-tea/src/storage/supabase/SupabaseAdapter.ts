import { historyRecordSchema, type HistoryRecord } from "../../schemas/historySchema";
import {
  autopilotSettingsSchema,
  autopilotSettingsUpsertSchema,
  modelInsightsCacheSchema,
  type AutopilotSettings,
  type AutopilotSettingsUpsert,
  type ModelInsightsCache,
} from "../../schemas/autopilotSettingsSchema";
import {
  alertCreateSchema,
  alertSchema,
  alertUpdateSchema,
  type AlertCreate,
  type AlertRecord,
  type AlertStatus,
  type AlertUpdate,
} from "../../schemas/alertSchema";
import {
  integrationRecordSchema,
  type IntegrationProvider,
  type IntegrationRecord,
  type IntegrationStatus,
} from "../../schemas/integrationSchema";
import { localEventsSchema, localEventsUpsertSchema, type LocalEvents, type LocalEventsUpsert } from "../../schemas/localEventsSchema";
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
  emailSubscriptionSchema,
  emailSubscriptionUpdateSchema,
  emailSubscriptionUpsertSchema,
  type EmailSubscription,
  type EmailSubscriptionUpdate,
  type EmailSubscriptionUpsert,
} from "../../schemas/emailSubscriptionSchema";
import {
  emailLogCreateSchema,
  emailLogSchema,
  emailLogUpdateSchema,
  type EmailLog,
  type EmailLogCreate,
  type EmailLogUpdate,
} from "../../schemas/emailSendSchema";
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
import { getSupabaseAdminClient } from "../../supabase/supabaseAdmin";
import { brandProfileSchema, type BrandProfile } from "../../schemas/brandSchema";
import { normalizeUSPhone } from "../../utils/phone";
import { nowMatchesLocalHour, timezoneOrDefault } from "../../utils/timezone";
import type { HistoryEndpoint, StorageAdapter } from "../StorageAdapter";

type BrandRow = {
  id: string;
  owner_id: string;
  brand_id: string;
  business_name: string;
  location: string;
  town_ref: string | null;
  type: string;
  voice: string;
  audiences: unknown;
  products_or_services: unknown;
  hours: string;
  typical_rush_times: string;
  slow_hours: string;
  offers_we_can_use: unknown;
  constraints: unknown;
  community_vibe_profile: unknown;
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

type IntegrationRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  provider: string;
  status: string;
  config: unknown;
  secrets_enc: string | null;
  created_at: string;
  updated_at: string;
};

type OutboxRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
};

type SmsContactRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  phone: string;
  name: string | null;
  tags: unknown;
  opted_in: boolean;
  consent_source: string | null;
  created_at: string;
};

type SmsMessageRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  to_phone: string;
  body: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  purpose: string | null;
  created_at: string;
  sent_at: string | null;
};

type EmailSubscriptionRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  to_email: string;
  cadence: string;
  day_of_week: number | null;
  hour: number | null;
  enabled: boolean;
  created_at: string;
};

type EmailLogRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  to_email: string;
  subject: string;
  status: string;
  provider_id: string | null;
  error: string | null;
  subscription_id: string | null;
  created_at: string;
  sent_at: string | null;
};

type AutopilotSettingsRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  enabled: boolean;
  cadence: string;
  hour: number;
  timezone: string;
  goals: unknown;
  focus_audiences: unknown;
  channels: unknown;
  allow_discounts: boolean;
  max_discount_text: string | null;
  notify_email: string | null;
  notify_sms: string | null;
  created_at: string;
  updated_at: string;
};

type ModelInsightsCacheRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  range_days: number;
  insights: unknown;
  computed_at: string;
};

type AlertRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  type: string;
  severity: string;
  message: string;
  context: unknown;
  status: string;
  created_at: string;
  resolved_at: string | null;
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
    townRef: row.town_ref ?? undefined,
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
    communityVibeProfile:
      typeof row.community_vibe_profile === "object" && row.community_vibe_profile !== null
        ? row.community_vibe_profile
        : {},
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

function toIntegrationRecord(brandId: string, row: IntegrationRow): IntegrationRecord {
  return integrationRecordSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    provider: row.provider,
    status: row.status,
    config:
      typeof row.config === "object" && row.config !== null && !Array.isArray(row.config)
        ? row.config
        : {},
    secretsEnc: row.secrets_enc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toOutboxRecord(brandId: string, row: OutboxRow): OutboxRecord {
  return outboxRecordSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    type: row.type,
    payload:
      typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
        ? row.payload
        : {},
    status: row.status,
    attempts: row.attempts ?? 0,
    lastError: row.last_error ?? undefined,
    scheduledFor: row.scheduled_for ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toSmsContact(brandId: string, row: SmsContactRow): SmsContact {
  return smsContactSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    phone: row.phone,
    name: row.name ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    optedIn: row.opted_in,
    consentSource: row.consent_source ?? undefined,
    createdAt: row.created_at,
  });
}

function toSmsMessage(brandId: string, row: SmsMessageRow): SmsMessage {
  return smsMessageSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    toPhone: row.to_phone,
    body: row.body,
    status: row.status,
    providerMessageId: row.provider_message_id ?? undefined,
    error: row.error ?? undefined,
    purpose: row.purpose ?? undefined,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
  });
}

function toEmailSubscription(brandId: string, row: EmailSubscriptionRow): EmailSubscription {
  return emailSubscriptionSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    toEmail: row.to_email,
    cadence: row.cadence,
    dayOfWeek: row.day_of_week ?? undefined,
    hour: row.hour ?? undefined,
    enabled: row.enabled,
    createdAt: row.created_at,
  });
}

function toEmailLog(brandId: string, row: EmailLogRow): EmailLog {
  return emailLogSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    toEmail: row.to_email,
    subject: row.subject,
    status: row.status,
    providerId: row.provider_id ?? undefined,
    error: row.error ?? undefined,
    subscriptionId: row.subscription_id ?? undefined,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
  });
}

function toAutopilotSettings(brandId: string, row: AutopilotSettingsRow): AutopilotSettings {
  return autopilotSettingsSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    enabled: row.enabled,
    cadence: row.cadence,
    hour: row.hour,
    timezone: timezoneOrDefault(row.timezone),
    goals: Array.isArray(row.goals) ? row.goals : [],
    focusAudiences: Array.isArray(row.focus_audiences) ? row.focus_audiences : [],
    channels: Array.isArray(row.channels) ? row.channels : [],
    allowDiscounts: row.allow_discounts,
    maxDiscountText: row.max_discount_text ?? undefined,
    notifyEmail: row.notify_email ?? undefined,
    notifySms: row.notify_sms ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toModelInsightsCache(brandId: string, row: ModelInsightsCacheRow): ModelInsightsCache {
  return modelInsightsCacheSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    rangeDays: row.range_days,
    insights:
      typeof row.insights === "object" && row.insights !== null && !Array.isArray(row.insights)
        ? row.insights
        : {},
    computedAt: row.computed_at,
  });
}

function toAlertRecord(brandId: string, row: AlertRow): AlertRecord {
  return alertSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandId,
    type: row.type,
    severity: row.severity,
    message: row.message,
    context:
      typeof row.context === "object" && row.context !== null && !Array.isArray(row.context)
        ? row.context
        : {},
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  });
}

export class SupabaseAdapter implements StorageAdapter {
  private readonly client = getSupabaseAdminClient();

  private table(tableName: string): any {
    return this.client.from(tableName as never);
  }

  private async getBrandRow(userId: string, brandId: string): Promise<BrandRow | null> {
    const { data, error } = await this.table("brands")
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
    const { data, error } = await this.table("brands")
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
      town_ref: parsed.townRef ?? null,
      type: parsed.type,
      voice: parsed.voice,
      audiences: parsed.audiences,
      products_or_services: parsed.productsOrServices,
      hours: parsed.hours,
      typical_rush_times: parsed.typicalRushTimes,
      slow_hours: parsed.slowHours,
      offers_we_can_use: parsed.offersWeCanUse,
      constraints: parsed.constraints,
      community_vibe_profile: parsed.communityVibeProfile,
    };

    const { data, error } = await this.table("brands").insert(payload).select("*").single();
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
      town_ref: merged.townRef ?? null,
      type: merged.type,
      voice: merged.voice,
      audiences: merged.audiences,
      products_or_services: merged.productsOrServices,
      hours: merged.hours,
      typical_rush_times: merged.typicalRushTimes,
      slow_hours: merged.slowHours,
      offers_we_can_use: merged.offersWeCanUse,
      constraints: merged.constraints,
      community_vibe_profile: merged.communityVibeProfile,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.table("brands")
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
    const { data, error } = await this.table("brands")
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

    const { data, error } = await this.table("history")
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

    const { data, error } = await this.table("history")
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
    const { data, error } = await this.table("history")
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

    const { data, error } = await this.table("posts")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        platform: parsed.platform,
        posted_at: postedAt,
        media_type: parsed.mediaType,
        caption_used: parsed.captionUsed,
        promo_name: parsed.promoName ?? null,
        notes: parsed.notes ?? null,
        status: parsed.status ?? "posted",
        provider_meta: parsed.providerMeta ?? null,
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
      status: string | null;
      provider_meta: unknown;
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
      status: row.status ?? "posted",
      providerMeta: row.provider_meta ?? undefined,
    });
  }

  async listPosts(userId: string, brandId: string, limit: number): Promise<StoredPost[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("posts")
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
        status: row.status ?? "posted",
        providerMeta: row.provider_meta ?? undefined,
      }),
    );
  }

  async addMetrics(userId: string, brandId: string, metrics: MetricsRequest): Promise<StoredMetrics> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = metricsRequestSchema.parse(metrics);
    const postRef = isUuid(parsed.postId) ? parsed.postId : null;

    const { data, error } = await this.table("metrics")
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
    const { data, error } = await this.table("metrics")
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

    const { data, error } = await this.table("schedule")
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
    let query = this.table("schedule")
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

    const { data, error } = await this.table("schedule")
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
    const { data, error } = await this.table("schedule")
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
    const { data, error } = await this.table("local_events")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false });
    if (error) {
      throw error;
    }

    const recurring = (data ?? [])
      .filter((row: any) => row.kind === "recurring")
      .map((row: any) => ({
        eventId: row.id as string,
        name: row.name as string,
        pattern: (row.pattern as string) ?? "",
        audience: (row.audience as string) ?? "",
        notes: (row.notes as string) ?? "",
      }));
    const oneOff = (data ?? [])
      .filter((row: any) => row.kind === "oneoff")
      .map((row: any) => ({
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
      const { error: deleteError } = await this.table("local_events")
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
      const { error } = await this.table("local_events").insert(inserts);
      if (error) {
        throw error;
      }
    }

    return this.listLocalEvents(userId, brandId);
  }

  async deleteLocalEvent(userId: string, brandId: string, eventId: string): Promise<boolean> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("local_events")
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

  async upsertIntegration(
    userId: string,
    brandId: string,
    provider: IntegrationProvider,
    status: IntegrationStatus,
    config: Record<string, unknown>,
    secretsEnc?: string | null,
  ): Promise<IntegrationRecord> {
    const brandRow = await this.requireBrandRow(userId, brandId);

    const { data: existing, error: existingError } = await this.table("integrations")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("provider", provider)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }

    if (existing) {
      const { data, error } = await this.table("integrations")
        .update({
          status,
          config,
          secrets_enc: secretsEnc ?? (existing as { secrets_enc?: string | null }).secrets_enc ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", (existing as { id: string }).id)
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return toIntegrationRecord(brandId, data as IntegrationRow);
    }

    const { data, error } = await this.table("integrations")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        provider,
        status,
        config,
        secrets_enc: secretsEnc ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toIntegrationRecord(brandId, data as IntegrationRow);
  }

  async getIntegration(
    userId: string,
    brandId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationRecord | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("integrations")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("provider", provider)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toIntegrationRecord(brandId, data as IntegrationRow);
  }

  async listIntegrations(userId: string, brandId: string): Promise<IntegrationRecord[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("integrations")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("provider", { ascending: true });
    if (error) {
      throw error;
    }
    return ((data ?? []) as IntegrationRow[]).map((row) => toIntegrationRecord(brandId, row));
  }

  async enqueueOutbox(
    userId: string,
    brandId: string,
    type: OutboxType,
    payload: Record<string, unknown>,
    scheduledFor?: string | null,
  ): Promise<OutboxRecord> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("outbox")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        type,
        payload,
        status: "queued",
        attempts: 0,
        scheduled_for: scheduledFor ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }

    return toOutboxRecord(brandId, data as OutboxRow);
  }

  async listOutbox(userId: string, brandId: string, limit: number): Promise<OutboxRecord[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("outbox")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }

    return ((data ?? []) as OutboxRow[]).map((row) => toOutboxRecord(brandId, row));
  }

  async listDueOutbox(nowIso: string, limit: number): Promise<OutboxRecord[]> {
    const { data, error } = await this.table("outbox")
      .select("*, brands!inner(brand_id)")
      .eq("status", "queued")
      .or(`scheduled_for.lte.${new Date(nowIso).toISOString()},scheduled_for.is.null`)
      .order("scheduled_for", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const mapped: OutboxRecord[] = [];
    for (const row of rows) {
      const brands = row.brands as { brand_id?: unknown } | null;
      if (!brands || typeof brands.brand_id !== "string") {
        continue;
      }
      const parsed = outboxRecordSchema.safeParse({
        id: row.id,
        ownerId: row.owner_id,
        brandId: brands.brand_id,
        type: row.type,
        payload:
          typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
            ? row.payload
            : {},
        status: row.status,
        attempts: row.attempts ?? 0,
        lastError: row.last_error ?? undefined,
        scheduledFor: row.scheduled_for ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      if (parsed.success) {
        mapped.push(parsed.data);
      }
    }
    return mapped;
  }

  async updateOutbox(id: string, updates: OutboxUpdate): Promise<OutboxRecord | null> {
    const parsedUpdates = outboxUpdateSchema.parse(updates);
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (parsedUpdates.status !== undefined) payload.status = parsedUpdates.status;
    if (parsedUpdates.attempts !== undefined) payload.attempts = parsedUpdates.attempts;
    if (parsedUpdates.lastError !== undefined) payload.last_error = parsedUpdates.lastError;
    if (parsedUpdates.scheduledFor !== undefined) payload.scheduled_for = parsedUpdates.scheduledFor;
    if (parsedUpdates.payload !== undefined) payload.payload = parsedUpdates.payload;

    const { data, error } = await this.table("outbox")
      .update(payload)
      .eq("id", id)
      .select("*, brands!inner(brand_id)")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const row = data as Record<string, unknown>;
    const brands = row.brands as { brand_id?: unknown } | null;
    if (!brands || typeof brands.brand_id !== "string") {
      return null;
    }
    return outboxRecordSchema.parse({
      id: row.id,
      ownerId: row.owner_id,
      brandId: brands.brand_id,
      type: row.type,
      payload:
        typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
          ? row.payload
          : {},
      status: row.status,
      attempts: row.attempts ?? 0,
      lastError: row.last_error ?? undefined,
      scheduledFor: row.scheduled_for ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async getOutboxById(userId: string, brandId: string, id: string): Promise<OutboxRecord | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("outbox")
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
    return toOutboxRecord(brandId, data as OutboxRow);
  }

  async listSmsContacts(userId: string, brandId: string, limit: number): Promise<SmsContact[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("sms_contacts")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }
    return ((data ?? []) as SmsContactRow[]).map((row) => toSmsContact(brandId, row));
  }

  async upsertSmsContact(userId: string, brandId: string, input: SmsContactUpsert): Promise<SmsContact> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = smsContactUpsertSchema.parse(input);
    const normalizedPhone = normalizeUSPhone(parsed.phone);

    const { data: existing, error: existingError } = await this.table("sms_contacts")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("phone", normalizedPhone)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }

    if (existing) {
      const { data, error } = await this.table("sms_contacts")
        .update({
          name: parsed.name?.trim() || null,
          tags: parsed.tags,
          opted_in: parsed.optedIn,
          consent_source: parsed.consentSource?.trim() || null,
        })
        .eq("id", (existing as { id: string }).id)
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return toSmsContact(brandId, data as SmsContactRow);
    }

    const { data, error } = await this.table("sms_contacts")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        phone: normalizedPhone,
        name: parsed.name?.trim() || null,
        tags: parsed.tags,
        opted_in: parsed.optedIn,
        consent_source: parsed.consentSource?.trim() || null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toSmsContact(brandId, data as SmsContactRow);
  }

  async updateSmsContact(
    userId: string,
    brandId: string,
    contactId: string,
    updates: SmsContactUpdate,
  ): Promise<SmsContact | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = smsContactUpdateSchema.parse(updates);
    const payload: Record<string, unknown> = {};
    if (parsed.phone !== undefined) payload.phone = normalizeUSPhone(parsed.phone);
    if (parsed.name !== undefined) payload.name = parsed.name.trim() || null;
    if (parsed.tags !== undefined) payload.tags = parsed.tags;
    if (parsed.optedIn !== undefined) payload.opted_in = parsed.optedIn;
    if (parsed.consentSource !== undefined) payload.consent_source = parsed.consentSource.trim() || null;

    const { data, error } = await this.table("sms_contacts")
      .update(payload)
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", contactId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toSmsContact(brandId, data as SmsContactRow);
  }

  async deleteSmsContact(userId: string, brandId: string, contactId: string): Promise<boolean> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("sms_contacts")
      .delete()
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", contactId)
      .select("id")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return Boolean(data);
  }

  async addSmsMessage(userId: string, brandId: string, input: SmsMessageCreate): Promise<SmsMessage> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = smsMessageCreateSchema.parse(input);

    const { data, error } = await this.table("sms_messages")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        to_phone: normalizeUSPhone(parsed.toPhone),
        body: parsed.body,
        status: parsed.status,
        provider_message_id: parsed.providerMessageId ?? null,
        error: parsed.error ?? null,
        purpose: parsed.purpose ?? null,
        sent_at: parsed.sentAt ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toSmsMessage(brandId, data as SmsMessageRow);
  }

  async listSmsMessages(userId: string, brandId: string, limit: number): Promise<SmsMessage[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("sms_messages")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }
    return ((data ?? []) as SmsMessageRow[]).map((row) => toSmsMessage(brandId, row));
  }

  async updateSmsMessage(
    userId: string,
    brandId: string,
    messageId: string,
    updates: SmsMessageUpdate,
  ): Promise<SmsMessage | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = smsMessageUpdateSchema.parse(updates);
    const payload: Record<string, unknown> = {};
    if (parsed.status !== undefined) payload.status = parsed.status;
    if (parsed.providerMessageId !== undefined) {
      payload.provider_message_id = parsed.providerMessageId;
    }
    if (parsed.error !== undefined) {
      payload.error = parsed.error;
    }
    if (parsed.sentAt !== undefined) {
      payload.sent_at = parsed.sentAt;
    }

    const { data, error } = await this.table("sms_messages")
      .update(payload)
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", messageId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toSmsMessage(brandId, data as SmsMessageRow);
  }

  async listEmailSubscriptions(
    userId: string,
    brandId: string,
    limit: number,
  ): Promise<EmailSubscription[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("email_subscriptions")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }
    return ((data ?? []) as EmailSubscriptionRow[]).map((row) =>
      toEmailSubscription(brandId, row),
    );
  }

  async upsertEmailSubscription(
    userId: string,
    brandId: string,
    input: EmailSubscriptionUpsert,
  ): Promise<EmailSubscription> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = emailSubscriptionUpsertSchema.parse(input);
    const normalizedEmail = parsed.toEmail.trim().toLowerCase();
    const nowDay = new Date().getUTCDay();

    const { data: existing, error: existingError } = await this.table(
      "email_subscriptions",
    )
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("to_email", normalizedEmail)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }

    const existingRow = existing as EmailSubscriptionRow | null;
    const payload = {
      owner_id: userId,
      brand_ref: brandRow.id,
      to_email: normalizedEmail,
      cadence: parsed.cadence,
      day_of_week:
        parsed.cadence === "weekly"
          ? parsed.dayOfWeek ?? existingRow?.day_of_week ?? nowDay
          : null,
      hour: parsed.hour ?? existingRow?.hour ?? 9,
      enabled: parsed.enabled ?? existingRow?.enabled ?? true,
    };

    if (existing) {
      const { data, error } = await this.table("email_subscriptions")
        .update({
          cadence: payload.cadence,
          day_of_week: payload.day_of_week,
          hour: payload.hour,
          enabled: payload.enabled,
        })
        .eq("id", (existing as { id: string }).id)
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return toEmailSubscription(brandId, data as EmailSubscriptionRow);
    }

    const { data, error } = await this.table("email_subscriptions")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toEmailSubscription(brandId, data as EmailSubscriptionRow);
  }

  async updateEmailSubscription(
    userId: string,
    brandId: string,
    subscriptionId: string,
    updates: EmailSubscriptionUpdate,
  ): Promise<EmailSubscription | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = emailSubscriptionUpdateSchema.parse(updates);
    const payload: Record<string, unknown> = {};
    if (parsed.toEmail !== undefined) payload.to_email = parsed.toEmail.trim().toLowerCase();
    if (parsed.cadence !== undefined) payload.cadence = parsed.cadence;
    if (parsed.dayOfWeek !== undefined) payload.day_of_week = parsed.dayOfWeek;
    if (parsed.hour !== undefined) payload.hour = parsed.hour;
    if (parsed.enabled !== undefined) payload.enabled = parsed.enabled;

    if (parsed.cadence === "daily" && parsed.dayOfWeek === undefined) {
      payload.day_of_week = null;
    }

    const { data, error } = await this.table("email_subscriptions")
      .update(payload)
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", subscriptionId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toEmailSubscription(brandId, data as EmailSubscriptionRow);
  }

  async deleteEmailSubscription(
    userId: string,
    brandId: string,
    subscriptionId: string,
  ): Promise<boolean> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("email_subscriptions")
      .delete()
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", subscriptionId)
      .select("id")
      .maybeSingle();
    if (error) {
      throw error;
    }
    return Boolean(data);
  }

  async listDueEmailSubscriptions(nowIso: string, limit: number): Promise<EmailSubscription[]> {
    const now = new Date(nowIso);
    const hour = now.getUTCHours();
    const dayOfWeek = now.getUTCDay();

    const { data, error } = await this.table("email_subscriptions")
      .select("*, brands!inner(brand_id)")
      .eq("enabled", true)
      .or(
        `and(cadence.eq.daily,hour.eq.${hour}),and(cadence.eq.weekly,day_of_week.eq.${dayOfWeek},hour.eq.${hour})`,
      )
      .order("created_at", { ascending: true })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const mapped: EmailSubscription[] = [];
    for (const row of rows) {
      const brands = row.brands as { brand_id?: unknown } | null;
      if (!brands || typeof brands.brand_id !== "string") {
        continue;
      }
      const parsed = emailSubscriptionSchema.safeParse({
        id: row.id,
        ownerId: row.owner_id,
        brandId: brands.brand_id,
        toEmail: row.to_email,
        cadence: row.cadence,
        dayOfWeek: row.day_of_week ?? undefined,
        hour: row.hour ?? undefined,
        enabled: row.enabled,
        createdAt: row.created_at,
      });
      if (parsed.success) {
        mapped.push(parsed.data);
      }
    }
    return mapped;
  }

  async addEmailLog(userId: string, brandId: string, input: EmailLogCreate): Promise<EmailLog> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = emailLogCreateSchema.parse(input);

    const { data, error } = await this.table("email_log")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        to_email: parsed.toEmail.trim().toLowerCase(),
        subject: parsed.subject,
        status: parsed.status,
        provider_id: parsed.providerId ?? null,
        error: parsed.error ?? null,
        subscription_id: parsed.subscriptionId ?? null,
        sent_at: parsed.sentAt ?? null,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toEmailLog(brandId, data as EmailLogRow);
  }

  async listEmailLogs(userId: string, brandId: string, limit: number): Promise<EmailLog[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("email_log")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }
    return ((data ?? []) as EmailLogRow[]).map((row) => toEmailLog(brandId, row));
  }

  async updateEmailLog(
    userId: string,
    brandId: string,
    logId: string,
    updates: EmailLogUpdate,
  ): Promise<EmailLog | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = emailLogUpdateSchema.parse(updates);
    const payload: Record<string, unknown> = {};
    if (parsed.status !== undefined) payload.status = parsed.status;
    if (parsed.providerId !== undefined) payload.provider_id = parsed.providerId;
    if (parsed.error !== undefined) payload.error = parsed.error;
    if (parsed.sentAt !== undefined) payload.sent_at = parsed.sentAt;

    const { data, error } = await this.table("email_log")
      .update(payload)
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", logId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toEmailLog(brandId, data as EmailLogRow);
  }

  async getAutopilotSettings(userId: string, brandId: string): Promise<AutopilotSettings | null> {
    const brandRow = await this.getBrandRow(userId, brandId);
    if (!brandRow) {
      return null;
    }
    const { data, error } = await this.table("autopilot_settings")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toAutopilotSettings(brandId, data as AutopilotSettingsRow);
  }

  async upsertAutopilotSettings(
    userId: string,
    brandId: string,
    input: AutopilotSettingsUpsert,
  ): Promise<AutopilotSettings> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = autopilotSettingsUpsertSchema.parse(input);
    const existing = await this.getAutopilotSettings(userId, brandId);
    const payload = {
      owner_id: userId,
      brand_ref: brandRow.id,
      enabled: parsed.enabled ?? existing?.enabled ?? false,
      cadence: parsed.cadence ?? existing?.cadence ?? "daily",
      hour: parsed.hour ?? existing?.hour ?? 7,
      timezone: timezoneOrDefault(parsed.timezone ?? existing?.timezone),
      goals: parsed.goals ?? existing?.goals ?? ["repeat_customers", "slow_hours"],
      focus_audiences: parsed.focusAudiences ?? existing?.focusAudiences ?? [],
      channels: parsed.channels ?? existing?.channels ?? ["facebook", "instagram"],
      allow_discounts: parsed.allowDiscounts ?? existing?.allowDiscounts ?? true,
      max_discount_text: parsed.maxDiscountText ?? existing?.maxDiscountText ?? null,
      notify_email:
        parsed.notifyEmail !== undefined
          ? parsed.notifyEmail.trim().toLowerCase() || null
          : existing?.notifyEmail ?? null,
      notify_sms:
        parsed.notifySms !== undefined
          ? parsed.notifySms.trim() || null
          : existing?.notifySms ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.table("autopilot_settings")
      .upsert(payload, {
        onConflict: "owner_id,brand_ref",
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toAutopilotSettings(brandId, data as AutopilotSettingsRow);
  }

  async listDueAutopilotSettings(nowIso: string, limit: number): Promise<AutopilotSettings[]> {
    const now = new Date(nowIso);
    const { data, error } = await this.table("autopilot_settings")
      .select("*, brands!inner(brand_id)")
      .eq("enabled", true)
      .order("updated_at", { ascending: true })
      .limit(Math.max(0, limit * 4));
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const due: AutopilotSettings[] = [];
    for (const row of rows) {
      const brands = row.brands as { brand_id?: unknown } | null;
      if (!brands || typeof brands.brand_id !== "string") {
        continue;
      }

      const settingsParsed = autopilotSettingsSchema.safeParse({
        id: row.id,
        ownerId: row.owner_id,
        brandId: brands.brand_id,
        enabled: row.enabled,
        cadence: row.cadence,
        hour: row.hour,
        timezone: row.timezone,
        goals: row.goals,
        focusAudiences: row.focus_audiences,
        channels: row.channels,
        allowDiscounts: row.allow_discounts,
        maxDiscountText: row.max_discount_text ?? undefined,
        notifyEmail: row.notify_email ?? undefined,
        notifySms: row.notify_sms ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      if (!settingsParsed.success || !settingsParsed.data.enabled) {
        continue;
      }
      const settings = settingsParsed.data;
      const match = nowMatchesLocalHour(now, settings.timezone, settings.hour);
      if (!match.matches) {
        continue;
      }
      if (settings.cadence === "weekday" && (match.weekdayIndex === 0 || match.weekdayIndex === 6)) {
        continue;
      }
      due.push(settings);
      if (due.length >= limit) {
        break;
      }
    }

    return due;
  }

  async listEnabledAutopilotSettings(limit: number): Promise<AutopilotSettings[]> {
    const { data, error } = await this.table("autopilot_settings")
      .select("*, brands!inner(brand_id)")
      .eq("enabled", true)
      .order("updated_at", { ascending: false })
      .limit(Math.max(0, limit));
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const mapped: AutopilotSettings[] = [];
    for (const row of rows) {
      const brands = row.brands as { brand_id?: unknown } | null;
      if (!brands || typeof brands.brand_id !== "string") {
        continue;
      }
      const parsed = autopilotSettingsSchema.safeParse({
        id: row.id,
        ownerId: row.owner_id,
        brandId: brands.brand_id,
        enabled: row.enabled,
        cadence: row.cadence,
        hour: row.hour,
        timezone: row.timezone,
        goals: row.goals,
        focusAudiences: row.focus_audiences,
        channels: row.channels,
        allowDiscounts: row.allow_discounts,
        maxDiscountText: row.max_discount_text ?? undefined,
        notifyEmail: row.notify_email ?? undefined,
        notifySms: row.notify_sms ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      if (parsed.success) {
        mapped.push(parsed.data);
      }
    }
    return mapped;
  }

  async getModelInsightsCache(
    userId: string,
    brandId: string,
    rangeDays: number,
  ): Promise<ModelInsightsCache | null> {
    const brandRow = await this.getBrandRow(userId, brandId);
    if (!brandRow) {
      return null;
    }
    const { data, error } = await this.table("model_insights_cache")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("range_days", Math.max(1, Math.floor(rangeDays)))
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toModelInsightsCache(brandId, data as ModelInsightsCacheRow);
  }

  async upsertModelInsightsCache(
    userId: string,
    brandId: string,
    rangeDays: number,
    insights: Record<string, unknown>,
    computedAt?: string,
  ): Promise<ModelInsightsCache> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const normalizedRangeDays = Math.max(1, Math.floor(rangeDays));
    const { data, error } = await this.table("model_insights_cache")
      .upsert(
        {
          owner_id: userId,
          brand_ref: brandRow.id,
          range_days: normalizedRangeDays,
          insights,
          computed_at: computedAt ?? new Date().toISOString(),
        },
        {
          onConflict: "owner_id,brand_ref,range_days",
        },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toModelInsightsCache(brandId, data as ModelInsightsCacheRow);
  }

  async addAlert(userId: string, brandId: string, input: AlertCreate): Promise<AlertRecord> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = alertCreateSchema.parse(input);
    const { data, error } = await this.table("alerts")
      .insert({
        owner_id: userId,
        brand_ref: brandRow.id,
        type: parsed.type,
        severity: parsed.severity,
        message: parsed.message,
        context: parsed.context ?? {},
        status: parsed.status,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toAlertRecord(brandId, data as AlertRow);
  }

  async listAlerts(
    userId: string,
    brandId: string,
    options?: { status?: AlertStatus | "all"; limit?: number },
  ): Promise<AlertRecord[]> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    let query = this.table("alerts")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, options?.limit ?? 100));
    if (options?.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return ((data ?? []) as AlertRow[]).map((row) => toAlertRecord(brandId, row));
  }

  async getAlertById(
    userId: string,
    brandId: string,
    alertId: string,
  ): Promise<AlertRecord | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const { data, error } = await this.table("alerts")
      .select("*")
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", alertId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toAlertRecord(brandId, data as AlertRow);
  }

  async updateAlert(
    userId: string,
    brandId: string,
    alertId: string,
    updates: AlertUpdate,
  ): Promise<AlertRecord | null> {
    const brandRow = await this.requireBrandRow(userId, brandId);
    const parsed = alertUpdateSchema.parse(updates);
    const payload: Record<string, unknown> = {};
    if (parsed.status !== undefined) payload.status = parsed.status;
    if (parsed.context !== undefined) payload.context = parsed.context;
    if (parsed.resolvedAt !== undefined) {
      payload.resolved_at = parsed.resolvedAt;
    } else if (parsed.status === "resolved") {
      payload.resolved_at = new Date().toISOString();
    }

    const { data, error } = await this.table("alerts")
      .update(payload)
      .eq("owner_id", userId)
      .eq("brand_ref", brandRow.id)
      .eq("id", alertId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return toAlertRecord(brandId, data as AlertRow);
  }
}
