import { getAdapter } from "../storage/getAdapter";
import { dispatchOutboxRecord } from "../integrations/dispatch";
import type { OutboxType } from "../schemas/outboxSchema";

const BACKOFF_MINUTES = [5, 15, 60, 240, 1440] as const;

function computeBackoffMs(nextAttemptNumber: number): number {
  const idx = Math.min(nextAttemptNumber - 1, BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx] * 60 * 1000;
}

type ProcessDueOutboxOptions = {
  limit?: number;
  types?: OutboxType[];
};

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
    try {
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
      failed += 1;
    }
  }

  return {
    processed: due.length,
    sent,
    failed,
  };
}
