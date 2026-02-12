import { processDueOutbox } from "./outboxProcessor";

let timer: NodeJS.Timeout | null = null;
let running = false;

function isRunnerEnabled(): boolean {
  const raw = (process.env.OUTBOX_RUNNER_ENABLED ?? "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function startJobRunner(intervalMs = 30_000): void {
  if (!isRunnerEnabled()) {
    return;
  }
  if (timer) {
    return;
  }

  timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void processDueOutbox()
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown outbox runner error";
        console.error(`Outbox runner error: ${message}`);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}

export function stopJobRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
