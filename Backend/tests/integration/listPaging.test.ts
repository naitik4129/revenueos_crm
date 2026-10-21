import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

/**
 * The contacts, companies and deals lists page ids first and count separately (dto.ts pageOf).
 * These tests page through every sort key (both directions) and the main filters, 7 rows at a
 * time, and compare with the one-query lists they replaced (kept here as the reference): same
 * rows, same order, same total, same company counts. The data has ties, case-only differences,
 * empty values, merged contacts and a second workspace.
 */
describe("lists: page first, count separately (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let pool: Pool;
  let svc: {
    contacts: typeof import("../../src/services/contacts.service.js");
    companies: typeof import("../../src/services/companies.service.js");
    deals: typeof import("../../src/services/deals.service.js");
    dto: typeof import("../../src/dto.js");
  };
  let ws: string;
  let owner: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    pool = (await import("../../src/db.js")).pool;
    svc = {
      contacts: await import("../../src/services/contacts.service.js"),
      companies: await import("../../src/services/companies.service.js"),
      deals: await import("../../src/services/deals.service.js"),
      dto: await import("../../src/dto.js"),
    };
    owner = (await seed.query(`insert into auth.users (email) values ('o@x.com') returning id`)).rows[0].id;
    await seed.query(`insert into crm.profiles (id, role) values ($1, 'salesperson')`, [owner]);
    ws = (await seed.query(`insert into crm.workspaces (name, slug) values ('W', 'w') returning id`)).rows[0].id;
    const other = (await seed.query(`insert into crm.workspaces (name, slug) values ('Other', 'other') returning id`)).rows[0].id;

    const day = (n: string) => `'2026-01-01'::timestamptz + (${n}) * interval '1 day'`;
    // 12 companies, each name twice (two differ only in case), created on 4 days; some owned.
    await seed.query(
      `insert into crm.companies (id, workspace_id, name, owner_id, created_at)
       select md5('co' || n)::uuid, $1, (array['acme', 'Acme', 'beta', 'Beta', 'Gamma', 'zeta'])[n % 6 + 1],
              case when n % 3 = 0 then $2::uuid end, ${day("n % 4")}
         from generate_series(1, 12) n`,
      [ws, owner],
    );
    // 40 contacts: names with case-only differences and ties, a quarter without company, created and
    // active on few days (ties), some owned, some DNC, some merged (hidden from the default list).
    await seed.query(
      `insert into crm.contacts (id, workspace_id, company_id, first_name, last_name, email, owner_id, created_at, last_activity_at)
       select md5('ct' || i)::uuid, $1, case when i % 4 = 0 then null else md5('co' || (i % 12 + 1))::uuid end,
              (array['ann', 'Ann', 'bob', 'Bob', 'cy'])[i % 5 + 1], (i % 3)::text, 'p' || i || '@x.com',
              case when i % 3 = 0 then $2::uuid end, ${day("i % 7")}, '2026-02-01'::timestamptz + (i % 5) * interval '1 day'
         from generate_series(1, 40) i`,
      [ws, owner],
    );
    await seed.query(`update crm.contacts set status = 'do_not_contact', dnc_reason = 'x' where workspace_id = $1 and email ~ '^p[0-9]*6@'`, [ws]);
    await seed.query(
      `update crm.contacts set status = 'merged', merged_into_contact_id = md5('ct1')::uuid where workspace_id = $1 and email ~ '^p[0-9]*3@' and id <> md5('ct1')::uuid`,
      [ws],
    );
    // Deals: an open one for even contacts (amount empty or tied), a won one for every 5th, a lost one for every 7th.
    await seed.query(
      `insert into crm.deals (workspace_id, contact_id, company_id, outcome, loss_reason, amount, last_activity_at)
       select $1, c.id, c.company_id, x.outcome::crm.deal_outcome, case when x.outcome = 'lost' then 'price_budget'::crm.loss_reason end,
              case when i % 3 = 0 then null else (i % 4) * 1000 end, '2026-03-01'::timestamptz + (i % 4) * interval '1 day'
         from generate_series(1, 40) i
         join crm.contacts c on c.id = md5('ct' || i)::uuid
         cross join lateral (values ('open', i % 2 = 0), ('won', i % 5 = 0), ('lost', i % 7 = 0)) x(outcome, wanted)
        where x.wanted and c.status <> 'merged'`,
      [ws],
    );
    // Open tasks on some open deals (the "missing next action" filter).
    await seed.query(
      `insert into crm.tasks (workspace_id, deal_id, contact_id, task_type, title, due_at)
       select workspace_id, id, contact_id, 'call', 'Call', now() from crm.deals where workspace_id = $1 and outcome = 'open' and amount is null`,
      [ws],
    );
    // Noise in another workspace.
    await seed.query(`insert into crm.companies (workspace_id, name) select $1, 'acme' from generate_series(1, 3)`, [other]);
    await seed.query(`insert into crm.contacts (workspace_id, first_name, email) select $1, 'ann', 'o' || i || '@x.com' from generate_series(1, 3) i`, [other]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  /** Every row of a list, 7 at a time. */
  async function pageAll<T extends { id: string }>(list: (o: { limit: number; offset: number }) => Promise<{ data: T[]; total: number }>) {
    const rows: T[] = [];
    let total = -1;
    for (let offset = 0; ; offset += 7) {
      const page = await list({ limit: 7, offset });
      total = page.total;
      rows.push(...page.data);
      if (page.data.length < 7) break;
    }
    return { rows, total };
  }
  const sorts = (keys: Record<string, string[]>) => [undefined, ...Object.keys(keys).flatMap((k) => [k, `-${k}`])];
  const ids = async (sql: string, params: unknown[]) => (await seed.query<{ id: string }>(sql, params)).rows.map((r) => r.id);

  it("the data is big enough to span pages", async () => {
    expect((await svc.contacts.listContacts(pool, ws, {})).total).toBeGreaterThan(20);
    expect((await svc.companies.listCompanies(pool, ws, {})).total).toBe(12);
    expect((await svc.deals.listDeals(pool, ws, {})).total).toBeGreaterThan(20);
  });

  it("contacts: same rows, order and total for every sort and filter", async () => {
    const filters: [object, string, unknown[]][] = [
      [{}, `c.status <> 'merged'`, []],
      [{ search: "ann" }, `c.status <> 'merged' and (concat_ws(' ', c.first_name, c.last_name) ilike $2 or c.email ilike $2 or c.phone ilike $2 or co.name ilike $2)`, ["%ann%"]],
      [{ ownerId: "none" }, `c.status <> 'merged' and c.owner_id is null`, []],
      [{ hasOpenDeal: true }, `c.status <> 'merged' and exists (select 1 from crm.deals d where d.contact_id = c.id and d.outcome = 'open')`, []],
      [{ hasOpenDeal: false }, `c.status <> 'merged' and not exists (select 1 from crm.deals d where d.contact_id = c.id and d.outcome = 'open')`, []],
      [{ status: "do_not_contact" }, `c.status = 'do_not_contact'`, []],
    ];
    for (const sort of sorts(svc.contacts.CONTACT_SORTS)) {
      for (const [f, where, extra] of filters) {
        const order = svc.dto.orderBySql(sort, svc.contacts.CONTACT_SORTS, "c.created_at desc", "c.id");
        const expected = await ids(`select c.id from crm.contacts c left join crm.companies co on co.id = c.company_id where c.workspace_id = $1 and ${where} ${order}`, [ws, ...extra]);
        const got = await pageAll((p) => svc.contacts.listContacts(pool, ws, { ...f, sort, ...p }));
        expect({ sort, f, ids: got.rows.map((r) => r.id), total: got.total }).toEqual({ sort, f, ids: expected, total: expected.length });
      }
    }
  });

  it("companies: same rows, order, total and counts for every sort and filter", async () => {
    const OLD_SORTS = { name: ["lower(co.name)"], contacts: ["co.contact_count"], openDeals: ["co.open_deal_count"], created: ["co.created_at"] };
    const old = `select co.id, co.contact_count, co.open_deal_count from (
                   select co.*, (select count(*)::int from crm.contacts c where c.company_id = co.id and c.status <> 'merged') as contact_count,
                          (select count(*)::int from crm.deals d where d.company_id = co.id and d.outcome = 'open') as open_deal_count
                     from crm.companies co) co`;
    const filters: [object, string, unknown[]][] = [
      [{}, `true`, []],
      [{ search: "a" }, `(co.name ilike $2 or co.domain ilike $2 or co.industry ilike $2)`, ["%a%"]],
      [{ ownerId: "none" }, `co.owner_id is null`, []],
    ];
    for (const sort of sorts(svc.companies.COMPANY_SORTS)) {
      for (const [f, where, extra] of filters) {
        const order = svc.dto.orderBySql(sort, OLD_SORTS, "co.name asc", "co.id");
        const expected = (await seed.query(`${old} where co.workspace_id = $1 and ${where} ${order}`, [ws, ...extra])).rows.map((r) => ({
          id: r.id,
          contactCount: r.contact_count,
          openDealCount: r.open_deal_count,
        }));
        const got = await pageAll((p) => svc.companies.listCompanies(pool, ws, { ...f, sort, ...p }));
        const rows = got.rows.map((r) => ({ id: r.id, contactCount: r.contactCount, openDealCount: r.openDealCount }));
        expect({ sort, f, rows, total: got.total }).toEqual({ sort, f, rows: expected, total: expected.length });
      }
    }
    // The data really has companies with different counts, so the count sorts are tested.
    expect(new Set((await seed.query(`${old} where co.workspace_id = $1`, [ws])).rows.map((r) => `${r.contact_count}/${r.open_deal_count}`)).size).toBeGreaterThan(2);
  });

  it("deals: same rows, order and total for every sort and filter", async () => {
    const from = `from crm.deals d join crm.contacts c on c.id = d.contact_id left join crm.companies co on co.id = d.company_id
                  left join lateral (select t.id from crm.tasks t where t.deal_id = d.id and t.status = 'open' order by t.due_at limit 1) na on true`;
    const filters: [object, string, unknown[]][] = [
      [{}, `true`, []],
      [{ outcome: "open" }, `d.outcome = 'open'`, []],
      [{ outcome: "open", missingNextAction: true }, `d.outcome = 'open' and d.outcome = 'open' and na.id is null`, []],
      [{ ownerId: "none" }, `d.owner_id is null`, []],
      [{ search: "bob" }, `(concat_ws(' ', c.first_name, c.last_name) ilike $2 or c.email ilike $2 or co.name ilike $2)`, ["%bob%"]],
    ];
    for (const sort of sorts(svc.deals.DEAL_SORTS)) {
      for (const [f, where, extra] of filters) {
        const order = svc.dto.orderBySql(sort, svc.deals.DEAL_SORTS, "d.last_activity_at desc", "d.id");
        const expected = await ids(`select d.id ${from} where d.workspace_id = $1 and ${where} ${order}`, [ws, ...extra]);
        const got = await pageAll((p) => svc.deals.listDeals(pool, ws, { ...f, sort, ...p }));
        expect({ sort, f, ids: got.rows.map((r) => r.id), total: got.total }).toEqual({ sort, f, ids: expected, total: expected.length });
      }
    }
  });
});
