import { pool } from "../db.js";
import { BaileysManager } from "./baileys.manager.js";

/**
 * One BaileysManager per workspace (each workspace pairs and owns its own
 * WhatsApp number — see the multi-workspace architecture plan). The worker
 * process is still a single Node process/poll loop; this registry is what
 * lets that one process hold N independent Baileys sockets, one per active
 * workspace, each with its own Postgres advisory lock so a second worker
 * process can never double-own the same workspace's session.
 */
class BaileysManagerRegistry {
  private readonly managers = new Map<string, BaileysManager>();
  private readonly starting = new Map<string, Promise<BaileysManager>>();

  /** Lazily starts (once) and returns the manager for a workspace. Safe to call repeatedly/concurrently for the same workspace. */
  async getOrCreateManager(workspaceId: string): Promise<BaileysManager> {
    const existing = this.managers.get(workspaceId);
    if (existing) return existing;

    const inFlight = this.starting.get(workspaceId);
    if (inFlight) return inFlight;

    const startPromise = (async () => {
      const manager = new BaileysManager(workspaceId);
      try {
        await manager.start();
      } finally {
        // A failed start is retried at the next workspace scan instead of staying "starting" forever.
        this.starting.delete(workspaceId);
      }
      this.managers.set(workspaceId, manager);
      return manager;
    })();
    this.starting.set(workspaceId, startPromise);
    return startPromise;
  }

  getExistingManager(workspaceId: string): BaileysManager | undefined {
    return this.managers.get(workspaceId);
  }

  /**
   * Called periodically by the worker so every workspace that WANTS a live
   * WhatsApp session has a running manager — a manager's heartbeat loop
   * (started in start()) is what reacts to an admin's connect/restart/logout
   * command (see BaileysManager.syncControl).
   *
   * We deliberately start a manager ONLY for workspaces whose
   * crm_whatsapp_connection asks to be connected (a row exists and
   * desired_state is not 'disconnected'). This matters because start() takes
   * a dedicated Postgres connection out of the pool and holds it for the
   * manager's whole lifetime (the pg_try_advisory_lock that stops a second
   * worker double-owning the session). Starting a manager for every active
   * workspace — including ones that never set up WhatsApp or are
   * disconnected — pins one pool connection each for sessions nobody wants,
   * which starved the rest of the worker (brain-feed, queries) of
   * connections. A workspace that later flips desired_state to
   * 'connected'/'restart' is picked up on the very next scan, so there is no
   * loss of responsiveness. Errors for one workspace (e.g. another process
   * still holding its advisory lock) are logged and skipped.
   */
  async ensureManagersForAllActiveWorkspaces(): Promise<void> {
    const result = await pool.query<{ id: string }>(
      `select w.id
         from crm_workspaces w
         join crm_whatsapp_connection c on c.workspace_id = w.id
        where w.is_active = true
          and c.desired_state is not null
          and c.desired_state <> 'disconnected'`,
    );
    const wanted = new Set(result.rows.map((row) => row.id));
    await Promise.all(
      result.rows.map(async (row) => {
        if (this.managers.has(row.id) || this.starting.has(row.id)) return;
        try {
          await this.getOrCreateManager(row.id);
        } catch (error) {
          console.error(`[baileys-registry] Failed to start WhatsApp session for workspace ${row.id}:`, error);
        }
      }),
    );

    // Release any manager whose workspace no longer wants a session (admin
    // disconnected, workspace deactivated). stop() unlocks the advisory lock
    // and returns its pool connection, so idle sessions never pin a
    // connection between scans.
    await Promise.all(
      [...this.managers.keys()]
        .filter((id) => !wanted.has(id))
        .map(async (id) => {
          const manager = this.managers.get(id);
          if (!manager) return;
          this.managers.delete(id);
          await manager.stop().catch((error) =>
            console.error(`[baileys-registry] Failed to stop WhatsApp session for workspace ${id}:`, error),
          );
        }),
    );
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.managers.values()].map((manager) => manager.stop().catch(() => undefined)));
    this.managers.clear();
    this.starting.clear();
  }
}

export const baileysRegistry = new BaileysManagerRegistry();
