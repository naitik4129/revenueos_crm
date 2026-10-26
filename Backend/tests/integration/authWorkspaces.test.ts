/**
 * P1: auth and workspace access over HTTP, on the PGlite test database. The CRM is driven by the
 * RevenueOS platform: an admin is a crm_profiles row; everyone else gets salesperson access, and
 * which workspaces they see, from platform project ownership/membership. Only Supabase Auth is
 * mocked: a bearer token is simply the user's id.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async (token: string) =>
        token === "invalid"
          ? { data: { user: null }, error: new Error("invalid token") }
          : { data: { user: { id: token } }, error: null },
      admin: {},
    },
  },
}));

describe("auth and workspaces (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;

  const ids = { admin: "", sales: "", sales2: "", inactive: "", noAccess: "", pA: "", pB: "", pC: "", w1: "", w2: "", wOff: "" };

  /** An auth account + platform profile, plus a crm_profiles row only when a role is given. */
  async function mkUser(email: string, name: string | null, role: "admin" | "salesperson" | null, active = true) {
    const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [id, name, email]);
    if (role) await seed.query(`insert into crm_profiles (id, role, is_active) values ($1, $2, $3)`, [id, role, active]);
    return id;
  }

  const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
  const get = (path: string, userId: string, workspaceId?: string) => {
    const r = request(app).get(path).set(as(userId));
    return workspaceId ? r.set("X-Workspace-Id", workspaceId) : r;
  };

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    appPool = (await import("../../src/db.js")).pool;

    ids.admin = await mkUser("admin@x.com", "Ada Admin", "admin");
    ids.sales = await mkUser("sam@x.com", "Sam Seller", null); // derived: access via project membership
    ids.sales2 = await mkUser("sue@x.com", null, null); // derived; name falls back to email
    ids.inactive = await mkUser("ian@x.com", "Ian Inactive", "salesperson", false); // deactivated crm_profiles
    ids.noAccess = await mkUser("pat@x.com", "Pat Platform", null); // platform account, no CRM access

    // Platform projects (owned by the admin) and their CRM workspaces (one-to-one).
    const project = async (name: string, key: string) =>
      (await seed.query(`insert into public.revenueos_projects (owner_id, customer_name, brain_customer_key) values ($1, $2, $3) returning id`, [ids.admin, name, key])).rows[0].id as string;
    ids.pA = await project("One", "one-aaa");
    ids.pB = await project("Two", "two-bbb");
    ids.pC = await project("Off", "off-ccc");

    // sales works on One, sales2 on Two (assigned on the platform).
    await seed.query(`insert into public.revenueos_project_members (project_id, user_id, added_by) values ($1, $2, $4), ($3, $5, $4)`, [ids.pA, ids.sales, ids.pB, ids.admin, ids.sales2]);

    const ws = async (name: string, slug: string, projectId: string, active = true) =>
      (await seed.query(`insert into crm_workspaces (name, slug, platform_project_id, is_active) values ($1, $2, $3, $4) returning id`, [name, slug, projectId, active])).rows[0].id as string;
    ids.w1 = await ws("One", "one-aaa", ids.pA);
    ids.w2 = await ws("Two", "two-bbb", ids.pB);
    ids.wOff = await ws("Off", "off-ccc", ids.pC, false);
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  describe("authentication", () => {
    it("returns the CRM user, name from the platform falling back to email", async () => {
      expect((await get("/api/v1/me", ids.sales)).body).toMatchObject({ id: ids.sales, name: "Sam Seller", role: "salesperson" });
      expect((await get("/api/v1/me", ids.sales2)).body).toMatchObject({ name: "sue@x.com", email: "sue@x.com", role: "salesperson" });
      expect((await get("/api/v1/me", ids.admin)).body).toMatchObject({ role: "admin" });
    });

    it("rejects a missing or invalid token with 401", async () => {
      expect((await request(app).get("/api/v1/me")).status).toBe(401);
      expect((await get("/api/v1/me", "invalid")).status).toBe(401);
    });

    it("rejects a platform account with no CRM access (no project, no profile) with 403", async () => {
      const res = await get("/api/v1/me", ids.noAccess);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/no CRM access/);
    });

    it("rejects a deactivated crm_profiles user with 403", async () => {
      const res = await get("/api/v1/me", ids.inactive);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/deactivated/);
    });
  });

  describe("workspace access", () => {
    it("admin sees all workspaces, including inactive ones", async () => {
      const res = await get("/api/v1/workspaces", ids.admin);
      expect(res.body.data.map((w: { name: string }) => w.name)).toEqual(["One", "Two", "Off"]);
    });

    it("a salesperson sees only the active workspaces for projects they own or are assigned to", async () => {
      expect((await get("/api/v1/workspaces", ids.sales)).body.data.map((w: { id: string }) => w.id)).toEqual([ids.w1]);
      expect((await get("/api/v1/workspaces", ids.sales2)).body.data.map((w: { id: string }) => w.id)).toEqual([ids.w2]);
    });

    // An unknown path inside the workspace-gated router: 404 "No route" means the gate passed.
    const probe = "/api/v1/__probe";

    it("lets an assigned user and an admin (anywhere) through requireWorkspace", async () => {
      expect((await get(probe, ids.sales, ids.w1)).body.error.message).toMatch(/No route/);
      expect((await get(probe, ids.admin, ids.w2)).body.error.message).toMatch(/No route/);
    });

    it("rejects a user with no access to the workspace with 403", async () => {
      const res = await get(probe, ids.sales, ids.w2);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/do not have access/);
    });

    it("treats a missing, malformed or inactive workspace as 404", async () => {
      for (const header of [undefined, "not-a-uuid", ids.wOff]) {
        const res = await get(probe, ids.sales, header);
        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe("Workspace not found.");
      }
    });
  });

  describe("workspace auto-creation", () => {
    it("creates a workspace for a platform project that has none, on listing", async () => {
      const pNew = (await seed.query(
        `insert into public.revenueos_projects (owner_id, customer_name, brain_customer_key) values ($1, 'Acme', 'acme-xyz') returning id`,
        [ids.admin],
      )).rows[0].id as string;

      const before = await seed.query(`select 1 from crm_workspaces where platform_project_id = $1`, [pNew]);
      expect(before.rows).toEqual([]);

      const res = await get("/api/v1/workspaces", ids.admin);
      expect(res.body.data.some((w: { platformProjectId: string }) => w.platformProjectId === pNew)).toBe(true);

      const after = await seed.query(`select slug from crm_workspaces where platform_project_id = $1`, [pNew]);
      expect(after.rows[0]?.slug).toBe("acme-xyz");
    });
  });

  describe("owner picker (/profiles)", () => {
    it("lists the workspace's platform project owner and members", async () => {
      const res = await get("/api/v1/profiles", ids.sales, ids.w1);
      expect(res.status).toBe(200);
      // pA is owned by the admin and has sales as a member.
      expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual([ids.admin, ids.sales].sort());
    });

    it("needs the workspace header and access to it", async () => {
      expect((await get("/api/v1/profiles", ids.sales)).status).toBe(404); // no workspace header
      expect((await get("/api/v1/profiles", ids.sales, ids.w2)).status).toBe(403); // not their workspace
    });
  });
});
