import type { BrandProfile } from "../schemas/brandSchema";
import type {
  AutopilotSettings,
  AutopilotSettingsUpsert,
  ModelInsightsCache,
} from "../schemas/autopilotSettingsSchema";
import type {
  AlertCreate,
  AlertRecord,
  AlertStatus,
  AlertUpdate,
} from "../schemas/alertSchema";
import type {
  EmailSubscription,
  EmailSubscriptionUpdate,
  EmailSubscriptionUpsert,
} from "../schemas/emailSubscriptionSchema";
import type {
  EmailLog,
  EmailLogCreate,
  EmailLogUpdate,
} from "../schemas/emailSendSchema";
import type { HistoryRecord } from "../schemas/historySchema";
import type {
  IntegrationProvider,
  IntegrationRecord,
  IntegrationStatus,
} from "../schemas/integrationSchema";
import type { LocalEvents, LocalEventsUpsert } from "../schemas/localEventsSchema";
import type { MetricsRequest, StoredMetrics } from "../schemas/metricsSchema";
import type {
  OutboxRecord,
  OutboxType,
  OutboxUpdate,
} from "../schemas/outboxSchema";
import type { PostRequest, StoredPost } from "../schemas/postSchema";
import type {
  SmsContact,
  SmsContactUpdate,
  SmsContactUpsert,
} from "../schemas/smsContactSchema";
import type {
  SmsMessage,
  SmsMessageCreate,
  SmsMessageUpdate,
} from "../schemas/smsSendSchema";
import type {
  ScheduleCreateRequest,
  ScheduleItem,
  ScheduleUpdateRequest,
} from "../schemas/scheduleSchema";

export type HistoryEndpoint =
  | "promo"
  | "social"
  | "events"
  | "week-plan"
  | "next-week-plan"
  | "daily_one_button"
  | "rescue_one_button"
  | "autopilot_run"
  | "alert-recommendations"
  | "publish"
  | "sms-send"
  | "gbp-post"
  | "email-digest";

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

  upsertIntegration(
    userId: string,
    brandId: string,
    provider: IntegrationProvider,
    status: IntegrationStatus,
    config: Record<string, unknown>,
    secretsEnc?: string | null,
  ): Promise<IntegrationRecord>;
  getIntegration(
    userId: string,
    brandId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationRecord | null>;
  listIntegrations(userId: string, brandId: string): Promise<IntegrationRecord[]>;

  enqueueOutbox(
    userId: string,
    brandId: string,
    type: OutboxType,
    payload: Record<string, unknown>,
    scheduledFor?: string | null,
  ): Promise<OutboxRecord>;
  listOutbox(userId: string, brandId: string, limit: number): Promise<OutboxRecord[]>;
  listDueOutbox(nowIso: string, limit: number): Promise<OutboxRecord[]>;
  updateOutbox(id: string, updates: OutboxUpdate): Promise<OutboxRecord | null>;
  getOutboxById(userId: string, brandId: string, id: string): Promise<OutboxRecord | null>;

  listSmsContacts(userId: string, brandId: string, limit: number): Promise<SmsContact[]>;
  upsertSmsContact(userId: string, brandId: string, input: SmsContactUpsert): Promise<SmsContact>;
  updateSmsContact(
    userId: string,
    brandId: string,
    contactId: string,
    updates: SmsContactUpdate,
  ): Promise<SmsContact | null>;
  deleteSmsContact(userId: string, brandId: string, contactId: string): Promise<boolean>;

  addSmsMessage(userId: string, brandId: string, input: SmsMessageCreate): Promise<SmsMessage>;
  listSmsMessages(userId: string, brandId: string, limit: number): Promise<SmsMessage[]>;
  updateSmsMessage(
    userId: string,
    brandId: string,
    messageId: string,
    updates: SmsMessageUpdate,
  ): Promise<SmsMessage | null>;

  listEmailSubscriptions(
    userId: string,
    brandId: string,
    limit: number,
  ): Promise<EmailSubscription[]>;
  upsertEmailSubscription(
    userId: string,
    brandId: string,
    input: EmailSubscriptionUpsert,
  ): Promise<EmailSubscription>;
  updateEmailSubscription(
    userId: string,
    brandId: string,
    subscriptionId: string,
    updates: EmailSubscriptionUpdate,
  ): Promise<EmailSubscription | null>;
  deleteEmailSubscription(
    userId: string,
    brandId: string,
    subscriptionId: string,
  ): Promise<boolean>;
  listDueEmailSubscriptions(nowIso: string, limit: number): Promise<EmailSubscription[]>;

  addEmailLog(userId: string, brandId: string, input: EmailLogCreate): Promise<EmailLog>;
  listEmailLogs(userId: string, brandId: string, limit: number): Promise<EmailLog[]>;
  updateEmailLog(
    userId: string,
    brandId: string,
    logId: string,
    updates: EmailLogUpdate,
  ): Promise<EmailLog | null>;

  getAutopilotSettings(userId: string, brandId: string): Promise<AutopilotSettings | null>;
  upsertAutopilotSettings(
    userId: string,
    brandId: string,
    input: AutopilotSettingsUpsert,
  ): Promise<AutopilotSettings>;
  listDueAutopilotSettings(nowIso: string, limit: number): Promise<AutopilotSettings[]>;
  listEnabledAutopilotSettings(limit: number): Promise<AutopilotSettings[]>;

  getModelInsightsCache(
    userId: string,
    brandId: string,
    rangeDays: number,
  ): Promise<ModelInsightsCache | null>;
  upsertModelInsightsCache(
    userId: string,
    brandId: string,
    rangeDays: number,
    insights: Record<string, unknown>,
    computedAt?: string,
  ): Promise<ModelInsightsCache>;

  addAlert(userId: string, brandId: string, input: AlertCreate): Promise<AlertRecord>;
  listAlerts(
    userId: string,
    brandId: string,
    options?: { status?: AlertStatus | "all"; limit?: number },
  ): Promise<AlertRecord[]>;
  getAlertById(userId: string, brandId: string, alertId: string): Promise<AlertRecord | null>;
  updateAlert(
    userId: string,
    brandId: string,
    alertId: string,
    updates: AlertUpdate,
  ): Promise<AlertRecord | null>;
}
