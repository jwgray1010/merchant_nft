import { getAdapter } from "../storage/getAdapter";
import { dispatchOutboxRecord } from "../integrations/dispatch";
import type { OutboxType } from "../schemas/outboxSchema";
import { getTwilioProvider } from "../integrations/providerFactory";
import { brandLifecycleStatusFor } from "../schemas/brandSchema";

const BACKOFF_MINUTES = [5, 15, 60, 240, 1440] as const;

function computeBackoffMs(nextAttemptNumber: number): number {
  const idx = Math.min(nextAttemptNumber - 1, BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx] * 60 * 1000;
}

type ProcessDueOutboxOptions = {
  limit?: number;
  types?: OutboxType[];
};

type SmsRecipient = { to: string; smsMessageId?: string };

function smsCronBatchSize(): number {
  const raw = Number.parseInt((process.env.SMS_CRON_BATCH_SIZE ?? "50").trim(), 10);
  if (Number.isNaN(raw) || raw <= 0) {
    return 50;
  }
  return Math.min(raw, 500);
}

function parseSmsRecipients(payload: Record<string, unknown>): SmsRecipient[] {
  const raw = payload.recipients;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        const to = entry.trim();
        return to ? ({ to } as SmsRecipient) : null;
      }
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        const to = typeof record.to === "string" ? record.to.trim() : "";
        if (!to) {
          return null;
        }
        const smsMessageId =
          typeof record.smsMessageId === "string" && record.smsMessageId.trim() !== ""
            ? record.smsMessageId.trim()
            : undefined;
        return { to, smsMessageId };
      }
      return null;
    })
    .filter((entry): entry is SmsRecipient => entry !== null);
}

async function processSmsSendOutbox(record: {
  id: string;
  ownerId: string;
  brandId: string;
  payload: Record<string, unknown>;
}) {
  const to = typeof record.payload.to === "string" ? record.payload.to.trim() : "";
  const bodyCandidate =
    typeof record.payload.body === "string"
      ? record.payload.body
      : typeof record.payload.message === "string"
        ? record.payload.message
        : "";
  const body = bodyCandidate.trim();

  if (!to || !body) {
    throw new Error("sms_send payload missing to/body");
  }

  const adapter = getAdapter();
  const provider = await getTwilioProvider(record.ownerId, record.brandId);
  const result = await provider.sendSms({ to, message: body });
  const smsMessageId =
    typeof record.payload.smsMessageId === "string" ? record.payload.smsMessageId : undefined;
  if (smsMessageId) {
    await adapter.updateSmsMessage(record.ownerId, record.brandId, smsMessageId, {
      status: "sent",
      providerMessageId: result.providerMessageId,
      error: null,
      sentAt: new Date().toISOString(),
    });
  }
  await adapter.addHistory(record.ownerId, record.brandId, "sms-send", record.payload, result);
}

async function processSmsCampaignOutbox(record: {
  id: string;
  ownerId: string;
  brandId: string;
  payload: Record<string, unknown>;
}): Promise<{ complete: boolean; remainingRecipients: SmsRecipient[]; hadFailures: boolean; error?: string }> {
  const bodyCandidate =
    typeof record.payload.body === "string"
      ? record.payload.body
      : typeof record.payload.message === "string"
        ? record.payload.message
        : "";
  const body = bodyCandidate.trim();
  if (!body) {
    throw new Error("sms_campaign payload missing body/message");
  }

  const recipients = parseSmsRecipients(record.payload);
  if (recipients.length === 0) {
    return { complete: true, remainingRecipients: [], hadFailures: false };
  }

  const batchSize = smsCronBatchSize();
  const batch = recipients.slice(0, batchSize);
  const untouched = recipients.slice(batchSize);
  const adapter = getAdapter();
  const provider = await getTwilioProvider(record.ownerId, record.brandId);

  const retryRecipients: SmsRecipient[] = [];
  let firstFailureMessage: string | undefined;

  for (const recipient of batch) {
    try {
      const result = await provider.sendSms({ to: recipient.to, message: body });
      if (recipient.smsMessageId) {
        await adapter.updateSmsMessage(record.ownerId, record.brandId, recipient.smsMessageId, {
          status: "sent",
          providerMessageId: result.providerMessageId,
          error: null,
          sentAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SMS campaign send error";
      if (!firstFailureMessage) {
        firstFailureMessage = message;
      }
      if (recipient.smsMessageId) {
        await adapter.updateSmsMessage(record.ownerId, record.brandId, recipient.smsMessageId, {
          status: "queued",
          error: message.slice(0, 1000),
        });
      }
      retryRecipients.push(recipient);
    }
  }

  await adapter.addHistory(record.ownerId, record.brandId, "sms-send", record.payload, {
    campaignRun: true,
    attempted: batch.length,
    successes: batch.length - retryRecipients.length,
    failures: retryRecipients.length,
  });

  const remainingRecipients = [...retryRecipients, ...untouched];
  return {
    complete: remainingRecipients.length === 0,
    remainingRecipients,
    hadFailures: retryRecipients.length > 0,
    error: firstFailureMessage,
  };
}

export async function processDueOutbox(options: ProcessDueOutboxOptions = {}): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const limit = options.limit ?? 20;
  const adapter = getAdapter();
  const nowIso = new Date().toISOString();
  const dueAll = await adapter.listDueOutbox(nowIso, limit);
  const due =
    options.types && options.types.length > 0
      ? dueAll.filter((record) => options.types!.includes(record.type))
      : dueAll;

  let sent = 0;
  let failed = 0;

  for (const record of due) {
    const nextAttempts = (record.attempts ?? 0) + 1;
    const recordBrand = await adapter.getBrand(record.ownerId, record.brandId).catch(() => null);
    if (recordBrand && brandLifecycleStatusFor(recordBrand) === "closed") {
      const closedMessage = "Brand is closed. Outbox delivery is disabled.";
      await adapter.updateOutbox(record.id, {
        status: "failed",
        attempts: nextAttempts,
        lastError: closedMessage,
        scheduledFor: null,
      });
      if (record.type === "sms_send") {
        const smsMessageId =
          typeof record.payload.smsMessageId === "string" ? record.payload.smsMessageId : undefined;
        if (smsMessageId) {
          await adapter.updateSmsMessage(record.ownerId, record.brandId, smsMessageId, {
            status: "failed",
            error: closedMessage,
          });
        }
      }
      if (record.type === "email_send") {
        const emailLogId =
          typeof record.payload.emailLogId === "string" ? record.payload.emailLogId : undefined;
        if (emailLogId) {
          await adapter.updateEmailLog(record.ownerId, record.brandId, emailLogId, {
            status: "failed",
            error: closedMessage,
          });
        }
      }
      failed += 1;
      continue;
    }
    try {
      if (record.type === "sms_send") {
        await processSmsSendOutbox(record);
        await adapter.updateOutbox(record.id, {
          status: "sent",
          attempts: nextAttempts,
          lastError: null,
          scheduledFor: null,
        });
        sent += 1;
        continue;
      }

      if (record.type === "sms_campaign") {
        const result = await processSmsCampaignOutbox(record);
        if (result.complete) {
          await adapter.updateOutbox(record.id, {
            status: "sent",
            lastError: null,
            scheduledFor: null,
            payload: {
              ...record.payload,
              recipients: [],
            },
          });
          sent += 1;
          continue;
        }

        if (result.hadFailures) {
          const shouldFail = nextAttempts >= BACKOFF_MINUTES.length;
          await adapter.updateOutbox(record.id, {
            status: shouldFail ? "failed" : "queued",
            attempts: nextAttempts,
            lastError: result.error ? result.error.slice(0, 1000) : undefined,
            scheduledFor: shouldFail
              ? null
              : new Date(Date.now() + computeBackoffMs(nextAttempts)).toISOString(),
            payload: {
              ...record.payload,
              recipients: result.remainingRecipients,
            },
          });

          if (shouldFail) {
            for (const recipient of result.remainingRecipients) {
              if (!recipient.smsMessageId) {
                continue;
              }
              await adapter.updateSmsMessage(
                record.ownerId,
                record.brandId,
                recipient.smsMessageId,
                {
                  status: "failed",
                  error: result.error ? result.error.slice(0, 1000) : "SMS campaign failed",
                },
              );
            }
            failed += 1;
          }
          continue;
        }

        await adapter.updateOutbox(record.id, {
          status: "queued",
          lastError: null,
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
          payload: {
            ...record.payload,
            recipients: result.remainingRecipients,
          },
        });
        continue;
      }

      await dispatchOutboxRecord(record);
      await adapter.updateOutbox(record.id, {
        status: "sent",
        attempts: nextAttempts,
        lastError: null,
        scheduledFor: null,
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown outbox error";
      const shouldFail = nextAttempts >= BACKOFF_MINUTES.length;

      await adapter.updateOutbox(record.id, {
        status: shouldFail ? "failed" : "queued",
        attempts: nextAttempts,
        lastError: message.slice(0, 1000),
        scheduledFor: shouldFail
          ? null
          : new Date(Date.now() + computeBackoffMs(nextAttempts)).toISOString(),
      });
      if (record.type === "sms_send") {
        const smsMessageId =
          typeof record.payload.smsMessageId === "string" ? record.payload.smsMessageId : undefined;
        if (smsMessageId) {
          await adapter.updateSmsMessage(record.ownerId, record.brandId, smsMessageId, {
            status: shouldFail ? "failed" : "queued",
            error: message.slice(0, 1000),
          });
        }
      }
      if (record.type === "email_send") {
        const emailLogId =
          typeof record.payload.emailLogId === "string" ? record.payload.emailLogId : undefined;
        if (emailLogId) {
          await adapter.updateEmailLog(record.ownerId, record.brandId, emailLogId, {
            status: shouldFail ? "failed" : "queued",
            error: message.slice(0, 1000),
          });
        }
      }
      failed += 1;
    }
  }

  return {
    processed: due.length,
    sent,
    failed,
  };
}
