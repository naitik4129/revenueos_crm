import { pool } from "./db.js";
import { workerEnv as env } from "./workerEnv.js";
import { runAutomationTick } from "./services/automation-runner.js";

/**
 * The automation worker: polls for due scheduled actions and runs them (automation-runner.ts).
 * shortcut: queued proposal/meeting WhatsApp sends and the per-workspace Baileys sessions come
 * back in P5 with the provider work; until then every message send is a dry run.
 */

let stopped = false;
const log = (message: string) => console.log(message);

async function loop(): Promise<void> {
  while (!stopped) {
    await runAutomationTick({ batchSize: env.WORKER_BATCH_SIZE, dryRun: env.WORKER_DRY_RUN, log })
      .then((claimed) => claimed && log(`[worker] Processed ${claimed} due action(s).`))
      .catch((err) => console.error("[worker] Poll tick failed:", err));
    if (stopped) break;
    await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
  }
}

console.log(
  `Northbeam CRM automation worker starting (poll interval ${env.WORKER_POLL_INTERVAL_MS}ms, batch size ${env.WORKER_BATCH_SIZE}, dry run ${env.WORKER_DRY_RUN}).`,
);
if (!env.WORKER_DRY_RUN) console.warn("[worker] Real email/WhatsApp sends are not wired up yet (P5): all sends run as dry run.");
void loop();

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down worker...`);
  stopped = true;
  try {
    await pool.end();
  } catch (err) {
    console.error("[worker] Error closing database pool during shutdown:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
