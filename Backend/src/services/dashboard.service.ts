import type { Queryable } from "../dto.js";
import { LIFECYCLE_STAGES, PIPELINE_STAGES, type TaskType } from "../domain/enums.js";

// Day/week/month boundaries are Asia/Kolkata calendar periods (weeks start Monday).
const istStart = (unit: "day" | "week" | "month") => `(date_trunc('${unit}', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
const TODAY = istStart("day");
const TOMORROW = `(${TODAY} + interval '1 day')`;
const WEEK = istStart("week");
const MONTH = istStart("month");

const closedThisMonth = (outcome: "won" | "lost") =>
  `(select count(*)::int from crm_deals where workspace_id = $1 and outcome = '${outcome}' and closed_at >= ${MONTH})`;

/** One workspace's dashboard numbers. Every query filters on workspace_id. */
export async function getDashboardSummary(db: Queryable, workspaceId: string) {
  const counts = await db.query<Record<string, number>>(
    `select
       ${closedThisMonth("won")} as won,
       ${closedThisMonth("lost")} as lost,
       (select count(*)::int from crm_calls where workspace_id = $1 and source = 'ai' and occurred_at >= ${WEEK}) as ai_calls,
       (select count(*)::int from crm_calls where workspace_id = $1 and source = 'human' and occurred_at >= ${WEEK}) as human_calls,
       (select count(*)::int from crm_email_activities where workspace_id = $1 and sent_at >= ${WEEK}) as emails_sent,
       (select count(*)::int from crm_email_activities where workspace_id = $1 and replied_at >= ${WEEK}) as emails_replied,
       (select count(*)::int from crm_tasks where workspace_id = $1 and status = 'open' and due_at >= ${TODAY} and due_at < ${TOMORROW}) as due_today,
       (select count(*)::int from crm_tasks where workspace_id = $1 and status = 'open' and due_at < ${TODAY}) as overdue,
       (select count(*)::int from crm_deals d where d.workspace_id = $1 and d.outcome = 'open'
           and not exists (select 1 from crm_tasks t where t.deal_id = d.id and t.status = 'open')) as missing_next_action,
       (select count(*)::int from crm_meetings where workspace_id = $1 and status not in ('cancelled', 'failed')
           and scheduled_at >= ${TODAY} and scheduled_at < ${TOMORROW}) as meetings_today,
       (select count(*)::int from crm_proposals where workspace_id = $1 and status in ('sent', 'revision_requested', 'revised')) as proposals_awaiting`,
    [workspaceId],
  );
  const lifecycle = await db.query<{ stage: string; count: number }>(
    `select lifecycle_stage as stage, count(*)::int as count from crm_contacts
      where workspace_id = $1 and status <> 'merged' group by 1`,
    [workspaceId],
  );
  const stages = await db.query<{ stage: string; count: number }>(
    `select stage, count(*)::int as count from crm_deals where workspace_id = $1 and outcome = 'open' group by 1`,
    [workspaceId],
  );
  const c = counts.rows[0]!;
  const countOf = (rows: { stage: string; count: number }[], stage: string) => rows.find((r) => r.stage === stage)?.count ?? 0;

  return {
    lifecycleFunnel: LIFECYCLE_STAGES.map((stage) => ({ stage, count: countOf(lifecycle.rows, stage) })),
    openDealsByStage: PIPELINE_STAGES.map((stage) => ({ stage, count: countOf(stages.rows, stage) })),
    dealsThisMonth: { won: c.won, lost: c.lost },
    activityThisWeek: { aiCalls: c.ai_calls, humanCalls: c.human_calls, emailsSent: c.emails_sent, emailsReplied: c.emails_replied },
    // Disjoint: overdue = due before today (IST), so no task counts in both.
    tasks: { dueToday: c.due_today, overdue: c.overdue },
    openDealsMissingNextAction: c.missing_next_action,
    meetingsToday: c.meetings_today,
    proposalsAwaitingDecision: c.proposals_awaiting,
  };
}

/** The current user's open tasks due today (IST), earliest first. */
export async function listTodaysQueue(db: Queryable, workspaceId: string, userId: string) {
  const result = await db.query<{
    id: string;
    deal_id: string | null;
    contact_id: string | null;
    contact_name: string | null;
    title: string;
    task_type: TaskType;
    due_at: Date;
  }>(
    `select t.id, t.deal_id, coalesce(t.contact_id, d.contact_id) as contact_id,
            nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as contact_name,
            t.title, t.task_type, t.due_at
       from crm_tasks t
       left join crm_deals d on d.id = t.deal_id
       left join crm_contacts c on c.id = coalesce(t.contact_id, d.contact_id)
      where t.workspace_id = $1 and t.owner_id = $2 and t.status = 'open'
        and t.due_at >= ${TODAY} and t.due_at < ${TOMORROW}
      order by t.due_at
      limit 50`,
    [workspaceId, userId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id ?? undefined,
    contactId: r.contact_id ?? undefined,
    contactName: r.contact_name ?? undefined,
    title: r.title,
    type: r.task_type,
    dueAt: r.due_at.toISOString(),
  }));
}
