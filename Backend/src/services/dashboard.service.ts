import type { Queryable } from "../dto.js";

/**
 * Aggregates the counts the existing Dashboard UI needs (product brief,
 * "DASHBOARD REQUIREMENTS") — deliberately just these, not a general
 * reporting platform. Reuses the read-only views the migration already
 * defines (lead_next_actions, active_leads_missing_next_action,
 * overdue_tasks, tasks_due_today) rather than re-deriving that logic here.
 */
export async function getDashboardSummary(db: Queryable) {
  const [activeLeads, dueToday, overdue, meetingsToday, proposalFollowUps, missingNextAction, funnel] = await Promise.all([
    db.query<{ count: string }>(`select count(*)::text as count from public.leads where lifecycle_state = 'active'`),
    db.query<{ count: string }>(`select count(*)::text as count from public.tasks_due_today`),
    db.query<{ count: string }>(`select count(*)::text as count from public.overdue_tasks`),
    db.query<{ count: string }>(
      `select count(*)::text as count from public.meetings
        where status not in ('cancelled') and scheduled_at >= date_trunc('day', now()) and scheduled_at < date_trunc('day', now()) + interval '1 day'`,
    ),
    db.query<{ count: string }>(`select count(*)::text as count from public.proposals where status in ('sent', 'revision_requested', 'revised')`),
    db.query<{ count: string }>(`select count(*)::text as count from public.active_leads_missing_next_action`),
    getPipelineFunnel(db),
  ]);

  return {
    activeLeads: Number(activeLeads.rows[0]?.count ?? 0),
    tasksDueToday: Number(dueToday.rows[0]?.count ?? 0),
    overdueActions: Number(overdue.rows[0]?.count ?? 0),
    meetingsToday: Number(meetingsToday.rows[0]?.count ?? 0),
    proposalFollowUps: Number(proposalFollowUps.rows[0]?.count ?? 0),
    leadsWithNoNextAction: Number(missingNextAction.rows[0]?.count ?? 0),
    pipelineFunnel: funnel,
  };
}

async function getPipelineFunnel(db: Queryable) {
  const totalLeads = await db.query<{ count: string }>(`select count(*)::text as count from public.leads`);
  const called = await db.query<{ count: string }>(`select count(distinct lead_id)::text as count from public.calls`);
  const connected = await db.query<{ count: string }>(`select count(distinct lead_id)::text as count from public.calls where connected = true`);
  const meetings = await db.query<{ count: string }>(`select count(distinct lead_id)::text as count from public.meetings`);
  const proposals = await db.query<{ count: string }>(`select count(distinct lead_id)::text as count from public.proposals`);
  const won = await db.query<{ count: string }>(`select count(*)::text as count from public.leads where lifecycle_state = 'won'`);

  return [
    { label: "Leads", value: Number(totalLeads.rows[0]?.count ?? 0) },
    { label: "Called", value: Number(called.rows[0]?.count ?? 0) },
    { label: "Connected", value: Number(connected.rows[0]?.count ?? 0) },
    { label: "Meetings", value: Number(meetings.rows[0]?.count ?? 0) },
    { label: "Proposals", value: Number(proposals.rows[0]?.count ?? 0) },
    { label: "Won", value: Number(won.rows[0]?.count ?? 0) },
  ];
}

export async function listTodaysQueue(db: Queryable) {
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
      where status = 'open' and due_at < date_trunc('day', now()) + interval '1 day'
      order by due_at asc
      limit 10`,
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
