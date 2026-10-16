/**
 * P1: auth, workspace access and admin user management over HTTP, on the PGlite test
 * database. Only Supabase Auth is mocked: a bearer token is simply the user's id.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

const authAdmin = vi.hoisted(() => ({ createUser: vi.fn(), deleteUser: vi.fn(), updateUserById: vi.fn() }));

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async (token: string) =>
        token === "invalid"
          ? { data: { user: null }, error: new Error("invalid token") }
          : { data: { user: { id: token } }, error: null },
      admin: authAdmin,
    },
  },
}));

describe("auth and workspaces (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;

  const ids = { admin: "", sales: "", sales2: "", inactive: "", noProfile: "", w1: "", w2: "", wOff: "" };

  /** Shared auth account + platform profile, plus a crm.profiles row unless role is null. */
  async function mkUser(email: string, name: string | null, role: "admin" | "salesperson" | null, active = true) {
    const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [id, name, email]);
    if (role) await seed.query(`insert into crm.profiles (id, role, is_active) values ($1, $2, $3)`, [id, role, active]);
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
    ids.sales = await mkUser("sam@x.com", "Sam Seller", "salesperson");
    ids.sales2 = await mkUser("sue@x.com", null, "salesperson");
    ids.inactive = await mkUser("ian@x.com", "Ian Inactive", "salesperson", false);
    ids.noProfile = await mkUser("pat@x.com", "Pat Platform", null);

    const ws = async (name: string, active = true) =>
      (await seed.query(`insert into crm.workspaces (name, slug, is_active) values ($1, $2, $3) returning id`, [name, name.toLowerCase(), active]))
        .rows[0].id as string;
    ids.w1 = await ws("One");
    ids.w2 = await ws("Two");
    ids.wOff = await ws("Off", false);
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2), ($3, $2)`, [ids.w1, ids.sales, ids.wOff]);
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  describe("authentication", () => {
    it("returns the CRM user with the platform name, falling back to email", async () => {
      expect((await get("/api/v1/me", ids.sales)).body).toMatchObject({ id: ids.sales, name: "Sam Seller", role: "salesperson" });
      expect((await get("/api/v1/me", ids.sales2)).body).toMatchObject({ name: "sue@x.com", email: "sue@x.com" });
    });

    it("rejects a missing or invalid token with 401", async () => {
      expect((await request(app).get("/api/v1/me")).status).toBe(401);
      expect((await get("/api/v1/me", "invalid")).status).toBe(401);
    });

    it("rejects a valid account without a crm profile with 403", async () => {
      const res = await get("/api/v1/me", ids.noProfile);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/no CRM access/);
    });

    it("rejects a deactivated user with 403", async () => {
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

    it("salesperson sees only active workspaces they are a member of", async () => {
      expect((await get("/api/v1/workspaces", ids.sales)).body.data.map((w: { id: string }) => w.id)).toEqual([ids.w1]);
      expect((await get("/api/v1/workspaces", ids.sales2)).body.data).toEqual([]);
    });

    // An unknown path inside the workspace-gated router: 404 "No route" means the gate passed.
    const probe = "/api/v1/__probe";

    it("lets a member and an admin (without membership) through requireWorkspace", async () => {
      expect((await get(probe, ids.sales, ids.w1)).body.error.message).toMatch(/No route/);
      expect((await get(probe, ids.admin, ids.w2)).body.error.message).toMatch(/No route/);
    });

    it("rejects a non-member with 403", async () => {
      const res = await get(probe, ids.sales, ids.w2);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/not a member/);
    });

    it("treats a missing, malformed or inactive workspace as 404", async () => {
      for (const header of [undefined, "not-a-uuid", ids.wOff]) {
        const res = await get(probe, ids.sales, header);
        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe("Workspace not found.");
      }
    });
  });

  describe("workspace administration (admin only)", () => {
    it("forbids salespeople from creating workspaces or managing members", async () => {
      expect((await request(app).post("/api/v1/workspaces").set(as(ids.sales)).send({ name: "Mine" })).status).toBe(403);
      expect((await get(`/api/v1/workspaces/${ids.w1}/members`, ids.sales)).status).toBe(403);
    });

    it("creates a workspace linked to an existing platform project only", async () => {
      const missing = await request(app)
        .post("/api/v1/workspaces")
        .set(as(ids.admin))
        .send({ name: "Acme", platformProjectId: "00000000-0000-0000-0000-000000000099" });
      expect(missing.status).toBe(400);

      const project = (await seed.query(`insert into public.revenueos_projects (customer_name) values ('Acme') returning id`)).rows[0].id;
      const created = await request(app).post("/api/v1/workspaces").set(as(ids.admin)).send({ name: "Acme", platformProjectId: project });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: "Acme", slug: "acme", platformProjectId: project, isActive: true });

      const dup = await request(app).post("/api/v1/workspaces").set(as(ids.admin)).send({ name: "Other", platformProjectId: project });
      expect(dup.status).toBe(409);
    });

    it("replaces members (salespeople only) and audits the change", async () => {
      const bad = await request(app).put(`/api/v1/workspaces/${ids.w2}/members`).set(as(ids.admin)).send({ userIds: [ids.admin] });
      expect(bad.status).toBe(400);

      const res = await request(app).put(`/api/v1/workspaces/${ids.w2}/members`).set(as(ids.admin)).send({ userIds: [ids.sales2] });
      expect(res.body.data.map((m: { id: string }) => m.id)).toEqual([ids.sales2]);
      expect((await get("/api/v1/workspaces", ids.sales2)).body.data.map((w: { id: string }) => w.id)).toEqual([ids.w2]);

      const audit = await seed.query(`select action from crm.admin_audit_events where target_id = $1`, [ids.w2]);
      expect(audit.rows.map((r) => r.action)).toContain("workspace.members_changed");
    });

    it("sets the default owner (admins only, active salesperson members only); removing the member clears it", async () => {
      const patch = (userId: string, defaultOwnerId: string | null) =>
        request(app).patch(`/api/v1/workspaces/${ids.w2}`).set(as(userId)).send({ defaultOwnerId });
      const members = (userIds: string[]) => request(app).put(`/api/v1/workspaces/${ids.w2}/members`).set(as(ids.admin)).send({ userIds });
      await members([ids.sales2, ids.inactive]);

      expect((await patch(ids.sales2, ids.sales2)).status).toBe(403);
      expect((await patch(ids.admin, ids.sales)).status).toBe(400); // not a member
      expect((await patch(ids.admin, ids.admin)).status).toBe(400); // admins are never members
      expect((await patch(ids.admin, ids.inactive)).status).toBe(400); // deactivated

      const ok = await patch(ids.admin, ids.sales2);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ defaultOwnerId: ids.sales2, defaultMeetingEmailTemplateId: null, defaultMeetingWhatsappTemplateId: null });

      await members([ids.inactive]);
      const w2 = (await get("/api/v1/workspaces", ids.admin)).body.data.find((w: { id: string }) => w.id === ids.w2);
      expect(w2.defaultOwnerId).toBeNull();

      await members([ids.sales2]);
      expect((await patch(ids.admin, null)).body.defaultOwnerId).toBeNull();
    });
  });

  describe("admin users", () => {
    it("gives an existing platform account CRM access without creating an auth user", async () => {
      const res = await request(app).post("/api/v1/admin/users").set(as(ids.admin)).send({ email: "PAT@x.com" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: ids.noProfile, name: "Pat Platform", role: "salesperson", active: true });
      expect(authAdmin.createUser).not.toHaveBeenCalled();
      expect((await get("/api/v1/me", ids.noProfile)).status).toBe(200);

      const again = await request(app).post("/api/v1/admin/users").set(as(ids.admin)).send({ email: "pat@x.com" });
      expect(again.status).toBe(409);
    });

    it("never creates auth accounts: an unknown email is refused, name/password are rejected", async () => {
      const unknown = await request(app).post("/api/v1/admin/users").set(as(ids.admin)).send({ email: "new@x.com" });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.message).toBe("No RevenueOS account with this email — create it on the platform first.");

      const extra = await request(app)
        .post("/api/v1/admin/users")
        .set(as(ids.admin))
        .send({ email: "new@x.com", name: "Nia New", password: "long-enough-password" });
      expect(extra.status).toBe(400);
      expect(authAdmin.createUser).not.toHaveBeenCalled();
    });

    it("deactivates by flag only, never touching the shared auth account", async () => {
      const res = await request(app).patch(`/api/v1/admin/users/${ids.sales2}`).set(as(ids.admin)).send({ active: false });
      expect(res.body).toMatchObject({ id: ids.sales2, active: false });
      expect(authAdmin.updateUserById).not.toHaveBeenCalled();
      expect(authAdmin.deleteUser).not.toHaveBeenCalled();
      expect((await get("/api/v1/me", ids.sales2)).status).toBe(403);
    });

    it("refuses to let an admin deactivate or demote themselves, and is admin-only", async () => {
      const self = await request(app).patch(`/api/v1/admin/users/${ids.admin}`).set(as(ids.admin)).send({ active: false });
      expect(self.status).toBe(400);
      expect((await get("/api/v1/admin/users", ids.sales)).status).toBe(403);
    });
  });
});
