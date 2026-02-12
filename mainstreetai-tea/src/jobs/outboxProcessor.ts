import { getAdapter } from "../storage/getAdapter";
import { dispatchOutboxRecord } from "../integrations/dispatch";

const MAX_ATTEMPTS = 5;

function computeBackoffMs(nextAttemptNumber: number): number {
  const cappedPower = Math.min(nextAttemptNumber, 6);
  const minutes = Math.min(60, 2 ** cappedPower);
  return minutes * 60 * 1000;
}

export async function processDueOutbox(limit = 20): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const adapter = getAdapter();
  const nowIso = new Date().toISOString();
  const due = await adapter.listDueOutbox(nowIso, limit);

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
      const shouldFail = nextAttempts >= MAX_ATTEMPTS;

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
