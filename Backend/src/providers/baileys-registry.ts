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
      await manager.start();
      this.managers.set(workspaceId, manager);
      this.starting.delete(workspaceId);
      return manager;
    })();
    this.starting.set(workspaceId, startPromise);
    return startPromise;
  }

  getExistingManager(workspaceId: string): BaileysManager | undefined {
    return this.managers.get(workspaceId);
  }

  /**
   * Called periodically by the worker so every active workspace has a
   * running manager — a manager's own heartbeat loop (started in start())
   * is what actually reacts to an admin's connect/restart/logout command
   * (see BaileysManager.syncControl), so a workspace that has never had a
   * manager started for it would otherwise never notice a connect request.
   * Errors for one workspace (e.g. another process still holding its
   * advisory lock) are logged and skipped rather than failing the others.
   */
  async ensureManagersForAllActiveWorkspaces(): Promise<void> {
    const result = await pool.query<{ id: string }>(`select id from crm.workspaces where is_active = true`);
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
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.managers.values()].map((manager) => manager.stop().catch(() => undefined)));
    this.managers.clear();
    this.starting.clear();
  }
}

export const baileysRegistry = new BaileysManagerRegistry();
