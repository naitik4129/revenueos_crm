import { pool } from "./db.js";
import { workerEnv as env } from "./workerEnv.js";
import { runAutomationTick } from "./services/automation-runner.js";
import { baileysRegistry } from "./providers/baileys-registry.js";

/**
 * The automation worker: polls for due scheduled actions and queued WhatsApp sends
 * (automation-runner.ts), and holds one Baileys session per active workspace.
 */

let stopped = false;
const log = (message: string) => console.log(message);

// New workspaces are rare, so the session scan runs less often than the action poll.
const WORKSPACE_SCAN_INTERVAL_TICKS = 6;
let tickCount = 0;

async function loop(): Promise<void> {
  while (!stopped) {
    await runAutomationTick({ batchSize: env.WORKER_BATCH_SIZE, dryRun: env.WORKER_DRY_RUN, log })
      .then((claimed) => claimed && log(`[worker] Processed ${claimed} item(s).`))
      .catch((err) => console.error("[worker] Poll tick failed:", err));
    if (tickCount++ % WORKSPACE_SCAN_INTERVAL_TICKS === 0) {
      await baileysRegistry.ensureManagersForAllActiveWorkspaces().catch((err) => console.error("[worker] Workspace WhatsApp session scan failed:", err));
    }
    if (stopped) break;
    await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
  }
}

console.log(
  `Northbeam CRM automation worker starting (poll interval ${env.WORKER_POLL_INTERVAL_MS}ms, batch size ${env.WORKER_BATCH_SIZE}, dry run ${env.WORKER_DRY_RUN}).`,
);
void baileysRegistry
  .ensureManagersForAllActiveWorkspaces()
  .then(() => loop())
  .catch(async (error) => {
    console.error("Automation worker failed to initialize per-workspace WhatsApp sessions:", error);
    await baileysRegistry.stopAll().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down worker...`);
  stopped = true;
  try {
    await baileysRegistry.stopAll();
    await pool.end();
  } catch (err) {
    console.error("[worker] Error closing database pool during shutdown:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
