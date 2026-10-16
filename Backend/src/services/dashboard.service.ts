import type { Queryable } from "../dto.js";
import { LIFECYCLE_STAGES, PIPELINE_STAGES } from "../domain/enums.js";

// Day/week/month boundaries are Asia/Kolkata calendar periods (weeks start Monday).
const istStart = (unit: "day" | "week" | "month") => `(date_trunc('${unit}', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
const TODAY = istStart("day");
const TOMORROW = `(${TODAY} + interval '1 day')`;
const WEEK = istStart("week");
const MONTH = istStart("month");

// shortcut: the close date comes from the Won/Lost timeline event (deals have no closed_at); add a column if this gets slow.
const closedThisMonth = (outcome: "won" | "lost", title: string) => `(
  select count(*)::int from crm.deals d
   where d.workspace_id = $1 and d.outcome = '${outcome}'
     and exists (select 1 from crm.timeline_events e
                  where e.deal_id = d.id and e.event_kind = 'system' and e.title = '${title}' and e.occurred_at >= ${MONTH}))`;

/** One workspace's dashboard numbers. Every query filters on workspace_id. */
export async function getDashboardSummary(db: Queryable, workspaceId: string) {
  const counts = await db.query<Record<string, number>>(
    `select
       ${closedThisMonth("won", "Won")} as won,
       ${closedThisMonth("lost", "Lost")} as lost,
       (select count(*)::int from crm.calls where workspace_id = $1 and source = 'ai' and occurred_at >= ${WEEK}) as ai_calls,
       (select count(*)::int from crm.calls where workspace_id = $1 and source = 'human' and occurred_at >= ${WEEK}) as human_calls,
       (select count(*)::int from crm.email_activities where workspace_id = $1 and sent_at >= ${WEEK}) as emails_sent,
       (select count(*)::int from crm.email_activities where workspace_id = $1 and replied_at >= ${WEEK}) as emails_replied,
       (select count(*)::int from crm.tasks where workspace_id = $1 and status = 'open' and due_at >= ${TODAY} and due_at < ${TOMORROW}) as due_today,
       (select count(*)::int from crm.tasks where workspace_id = $1 and status = 'open' and due_at < now()) as overdue,
       (select count(*)::int from crm.deals d where d.workspace_id = $1 and d.outcome = 'open'
           and not exists (select 1 from crm.tasks t where t.deal_id = d.id and t.status = 'open')) as missing_next_action,
       (select count(*)::int from crm.meetings where workspace_id = $1 and status not in ('cancelled', 'failed')
           and scheduled_at >= ${TODAY} and scheduled_at < ${TOMORROW}) as meetings_today,
       (select count(*)::int from crm.proposals where workspace_id = $1 and status in ('sent', 'revision_requested', 'revised')) as proposals_awaiting`,
    [workspaceId],
  );
  const lifecycle = await db.query<{ stage: string; count: number }>(
    `select lifecycle_stage as stage, count(*)::int as count from crm.contacts
      where workspace_id = $1 and status <> 'merged' group by 1`,
    [workspaceId],
  );
  const stages = await db.query<{ stage: string; count: number }>(
    `select stage, count(*)::int as count from crm.deals where workspace_id = $1 and outcome = 'open' group by 1`,
    [workspaceId],
  );
  const c = counts.rows[0]!;
  const countOf = (rows: { stage: string; count: number }[], stage: string) => rows.find((r) => r.stage === stage)?.count ?? 0;

  return {
    lifecycleFunnel: LIFECYCLE_STAGES.map((stage) => ({ stage, count: countOf(lifecycle.rows, stage) })),
    openDealsByStage: PIPELINE_STAGES.map((stage) => ({ stage, count: countOf(stages.rows, stage) })),
    dealsThisMonth: { won: c.won, lost: c.lost },
    activityThisWeek: { aiCalls: c.ai_calls, humanCalls: c.human_calls, emailsSent: c.emails_sent, emailsReplied: c.emails_replied },
    // Same rules as the tasks list filters (dueTodayOnly / overdueOnly), so a task due earlier today counts in both.
    tasks: { dueToday: c.due_today, overdue: c.overdue },
    openDealsMissingNextAction: c.missing_next_action,
    meetingsToday: c.meetings_today,
    proposalsAwaitingDecision: c.proposals_awaiting,
  };
}
