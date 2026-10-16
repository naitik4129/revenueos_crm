import { describe, expect, it } from "vitest";
import type { Queryable } from "../../src/dto.js";
import {
  updateWorkflow,
  type WorkflowRow,
} from "../../src/services/workflows.service.js";

const WORKSPACE_ID = "workspace-1";

function createWorkflowDb() {
  const row: WorkflowRow = {
    id: "workflow-1",
    workspace_id: WORKSPACE_ID,
    name: "Original workflow",
    description: "Original description",
    trigger: "manual_enrollment",
    status: "paused",
    owner_id: "user-1",
    created_by: "user-1",
    created_by_name: "Test User",
    created_at: new Date("2030-01-01T00:00:00.000Z"),
    updated_at: new Date("2030-01-01T00:00:00.000Z"),
  };

  return {
    row,
    db: {
      query: async (sql: string, params?: unknown[]) => {
        if (/^select \* from (public|crm)\.workflows /.test(sql)) {
          return { rows: [row] };
        }
        if (sql.startsWith("update public.workflows set")) {
          row.updated_at = new Date("2030-01-02T00:00:00.000Z");
          const assignments = sql
            .slice("update public.workflows set ".length)
            .split(" where ")[0]!;
          const columns = assignments
            .split(", ")
            .map((assignment) => assignment.split(" = ")[0]);
          columns.forEach((column, index) => {
            const value = params?.[index];
            if (column === "name") row.name = value as string;
            if (column === "description") row.description = value as string;
          });
          return { rows: [] };
        }
        if (sql.startsWith("select * from public.workflow_versions")) {
          return { rows: [] };
        }
        if (sql.includes("from public.workflow_runs")) {
          return { rows: [{ count: "0" }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as Queryable,
  };
}

describe("updateWorkflow", () => {
  it("persists trimmed workflow name and clears description", async () => {
    const { db } = createWorkflowDb();

    const workflow = await updateWorkflow(db, WORKSPACE_ID, "workflow-1", {
      name: "  Updated workflow  ",
      description: "   ",
    });

    expect(workflow.name).toBe("Updated workflow");
    expect(workflow.description).toBe("");
  });

  it("rejects whitespace-only workflow names", async () => {
    const { db } = createWorkflowDb();

    await expect(
      updateWorkflow(db, WORKSPACE_ID, "workflow-1", { name: "   " }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "Workflow name is required.",
    });
  });
});
