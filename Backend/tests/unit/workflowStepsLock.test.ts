/**
 * Replaces the old real-Postgres concurrency test: two overlapping saves of the same draft must
 * not interleave. updateDraftSteps locks the version row (`for update`) before delete + insert.
 * This fake database models that row lock (held until the "transaction" ends) and the
 * workflow_steps_unique_order constraint, and yields between queries so that without the lock
 * the two saves would interleave and collide.
 */
import { describe, expect, it } from "vitest";
import type { Queryable } from "../../src/dto.js";
import { updateDraftSteps, type StepInput } from "../../src/services/workflows.service.js";

const workflow = {
  id: "wf-1",
  workspace_id: "ws-1",
  name: "W",
  description: null,
  trigger: "manual_enrollment",
  status: "paused",
  owner_id: null,
  created_by: null,
  created_at: new Date(),
  updated_at: new Date(),
};
const version = { id: "v-1", workflow_id: "wf-1", version_number: 1, status: "draft", created_by: null, created_by_name: null, created_at: new Date(), published_at: null };

function fakeDatabase() {
  const steps: { workflow_version_id: string; step_order: number; action: string }[] = [];
  let lockHolder: object | null = null;
  const waiters: (() => void)[] = [];
  const log: string[] = [];

  function client(name: string) {
    const self = {};
    const db = {
      async query(sql: string, params: unknown[] = []) {
        await new Promise((resolve) => setImmediate(resolve)); // let the other save run in between
        if (sql.includes("from crm.workflow_versions") && sql.includes("for update")) {
          while (lockHolder && lockHolder !== self) await new Promise<void>((resolve) => waiters.push(resolve));
          lockHolder = self;
          return { rows: [version] };
        }
        if (sql.startsWith("select * from crm.workflows")) return { rows: [workflow] };
        if (sql.includes("from crm.workflow_versions")) return { rows: [version] };
        if (sql.startsWith("delete from crm.workflow_steps")) {
          log.push(`${name}:delete`);
          for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.workflow_version_id === params[0]) steps.splice(i, 1);
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith("insert into crm.workflow_steps")) {
          const [, versionId, order, , action] = params as [string, string, number, number, string];
          if (steps.some((s) => s.workflow_version_id === versionId && s.step_order === order)) {
            throw new Error('duplicate key value violates unique constraint "workflow_steps_unique_order"');
          }
          log.push(`${name}:insert`);
          steps.push({ workflow_version_id: versionId, step_order: order, action });
          return { rows: [] };
        }
        if (sql.includes("from crm.workflow_steps")) return { rows: steps.map((s) => ({ ...s, id: `s-${s.step_order}`, delay_days: 0, template_id: null, config: null, is_enabled: true })) };
        if (sql.includes("from crm.workflow_runs")) return { rows: [{ count: "0" }] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as Queryable;
    /** End of the caller's transaction: the row lock is released. */
    const commit = () => {
      if (lockHolder === self) lockHolder = null;
      waiters.splice(0).forEach((wake) => wake());
    };
    return { db, commit };
  }
  return { steps, log, client };
}

const save = async (c: { db: Queryable; commit: () => void }, s: StepInput[]) => {
  try {
    return await updateDraftSteps(c.db, "ws-1", "wf-1", 1, s);
  } finally {
    c.commit();
  }
};

const steps = (...actions: StepInput["action"][]): StepInput[] => actions.map((action, order) => ({ order, action, delayDays: 0, enabled: true }));

describe("updateDraftSteps under overlapping saves", () => {
  it("serializes two saves of the same draft: no unique-order error, last save wins", async () => {
    const fake = fakeDatabase();
    const a = fake.client("A");
    const b = fake.client("B");

    await expect(Promise.all([save(a, steps("create_call_task", "create_follow_up_task")), save(b, steps("stop_workflow", "create_call_task", "create_follow_up_task"))])).resolves.toHaveLength(2);

    // Each save's delete + inserts ran as one block (the lock), never interleaved with the other's.
    const blocks = fake.log.join(" ");
    expect(blocks).toMatch(/^(A:delete( A:insert){2} B:delete( B:insert){3}|B:delete( B:insert){3} A:delete( A:insert){2})$/);
    expect(new Set(fake.steps.map((s) => s.step_order)).size).toBe(fake.steps.length);
  });
});
