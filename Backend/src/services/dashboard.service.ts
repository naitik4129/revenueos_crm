import type { Queryable } from "../dto.js";

/**
 * Aggregates the counts the existing Dashboard UI needs (product brief,
 * "DASHBOARD REQUIREMENTS") — deliberately just these, not a general
 * reporting platform. Every query here is scoped to workspaceId so a
 * workspace's dashboard never leaks another workspace's numbers.
 *
 * Deliberately does NOT select from public.overdue_tasks /
 * public.active_leads_missing_next_action (the read-only views
 * 001_initial_migration.sql defines): those views were created with a bare
 * `select *` / `select l.*` before workspace_id existed on tasks/leads, and
 * Postgres freezes a view's column list at CREATE VIEW time — a later
 * `alter table ... add column workspace_id` does NOT propagate into an
 * already-created view. 015_workspaces.sql never recreates them, so neither
 * view actually exposes a workspace_id column to filter on. The underlying
 * table logic is inlined below instead of relying on those views.
 */
export async function getDashboardSummary(db: Queryable, workspaceId: string) {
  const [activeLeads, dueToday, overdue, meetingsToday, proposalFollowUps, missingNextAction, automationFailures, funnel] = await Promise.all([
    db.query<{ count: string }>(`select count(*)::text as count from public.leads where workspace_id = $1 and lifecycle_state = 'active'`, [workspaceId]),
    db.query<{ count: string }>(
      `select count(*)::text as count from public.tasks
        where workspace_id = $1
          and status = 'open'
          and due_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
          and due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'`,
      [workspaceId],
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count from public.tasks where workspace_id = $1 and status = 'open' and due_at < now()`,
      [workspaceId],
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count from public.meetings
        where workspace_id = $1
          and status not in ('cancelled')
          and scheduled_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
          and scheduled_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'`,
      [workspaceId],
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count from public.proposals where workspace_id = $1 and status in ('sent', 'revision_requested', 'revised')`,
      [workspaceId],
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count
         from public.leads l
        where l.workspace_id = $1
          and l.lifecycle_state = 'active'
          and not exists (select 1 from public.tasks t where t.lead_id = l.id and t.status = 'open')`,
      [workspaceId],
    ),
    db.query<{ count: string }>(
      `select count(*)::text as count from public.workflow_runs where workspace_id = $1 and status = 'failed'`,
      [workspaceId],
    ),
    getPipelineFunnel(db, workspaceId),
  ]);

  return {
    activeLeads: Number(activeLeads.rows[0]?.count ?? 0),
    tasksDueToday: Number(dueToday.rows[0]?.count ?? 0),
    overdueActions: Number(overdue.rows[0]?.count ?? 0),
    meetingsToday: Number(meetingsToday.rows[0]?.count ?? 0),
    proposalFollowUps: Number(proposalFollowUps.rows[0]?.count ?? 0),
    leadsWithNoNextAction: Number(missingNextAction.rows[0]?.count ?? 0),
    automationFailures: Number(automationFailures.rows[0]?.count ?? 0),
    pipelineFunnel: funnel,
  };
}

async function getPipelineFunnel(db: Queryable, workspaceId: string) {
  const totalLeads = await db.query<{ count: string }>(`select count(*)::text as count from public.leads where workspace_id = $1`, [workspaceId]);
  const called = await db.query<{ count: string }>(
    `select count(distinct lead_id)::text as count from public.calls where workspace_id = $1`,
    [workspaceId],
  );
  const connected = await db.query<{ count: string }>(
    `select count(distinct lead_id)::text as count from public.calls where workspace_id = $1 and connected = true`,
    [workspaceId],
  );
  const meetings = await db.query<{ count: string }>(
    `select count(distinct lead_id)::text as count from public.meetings where workspace_id = $1`,
    [workspaceId],
  );
  const proposals = await db.query<{ count: string }>(
    `select count(distinct lead_id)::text as count from public.proposals where workspace_id = $1`,
    [workspaceId],
  );
  const won = await db.query<{ count: string }>(
    `select count(*)::text as count from public.leads where workspace_id = $1 and lifecycle_state = 'won'`,
    [workspaceId],
  );

  return [
    { label: "Leads", value: Number(totalLeads.rows[0]?.count ?? 0) },
    { label: "Called", value: Number(called.rows[0]?.count ?? 0) },
    { label: "Connected", value: Number(connected.rows[0]?.count ?? 0) },
    { label: "Meetings", value: Number(meetings.rows[0]?.count ?? 0) },
    { label: "Proposals", value: Number(proposals.rows[0]?.count ?? 0) },
    { label: "Won", value: Number(won.rows[0]?.count ?? 0) },
  ];
}

export async function listTodaysQueue(db: Queryable, workspaceId: string) {
  const result = await db.query<{
    id: string;
    lead_id: string;
    title: string;
    task_type: string;
    due_at: Date;
    owner_id: string | null;
  }>(
    `select id, lead_id, title, task_type, due_at, owner_id
       from public.tasks
      where workspace_id = $1
        and status = 'open'
        and due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'
      order by due_at asc
      limit 10`,
    [workspaceId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    title: r.title,
    type: r.task_type,
    dueAt: r.due_at.toISOString(),
    ownerId: r.owner_id ?? undefined,
  }));
}
