/**
 * LOAD TEST ONLY. Rebuilds the local crm_load database (Supabase stand-ins + migrations) and seeds
 * three workspaces in plain SQL (generate_series), fast enough to rerun every time.
 *
 * Ids are md5(workspace key : kind : n)::uuid, so rows link up without lookups and the runner
 * can name any record: contact n of workspace A is `uid("A", "ct", n)`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { MIGRATIONS_DIR, SUPABASE_STANDINS } from "../tests/integration/testDb.js";

export const uid = (ws: string, kind: string, n: number | string) => {
  const h = createHash("md5").update(`${ws}:${kind}:${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const sqlUid = (ws: string, kind: string, n: string) => `md5('${ws}:${kind}:' || ${n})::uuid`;

export const USERS = [
  { id: uid("U", "user", 0), email: "admin@load.local", name: "Load Admin", role: "admin" as const },
  ...["Sam", "Priya", "Ravi", "Meera", "Kabir", "Isha"].map((name, i) => ({
    id: uid("U", "user", i + 1),
    email: `${name.toLowerCase()}@load.local`,
    name: `${name} Sales`,
    role: "salesperson" as const,
  })),
];
const SALES_IDS = USERS.filter((u) => u.role === "salesperson").map((u) => u.id);
/** 1 in 7 records unassigned: index 7 of a 6-element array is null. */
const OWNER = (g: string) => `(array[${SALES_IDS.map((id) => `'${id}'::uuid`).join(", ")}])[1 + (${g} % 7)]`;

export interface WorkspaceSpec {
  key: string;
  name: string;
  contacts: number;
}
/** One full-size client and two smaller ones, so scans across workspaces show up. */
export const WORKSPACES: WorkspaceSpec[] = [
  { key: "A", name: "Load Client A", contacts: 15_000 },
  { key: "B", name: "Load Client B", contacts: 5_000 },
  { key: "C", name: "Load Client C", contacts: 5_000 },
];
export const wsId = (key: string) => uid(key, "ws", 0);
/** Sizes derived from the contact count (A: 15k companies, 5k open + 3k closed deals, ~100k activity rows). */
export const sizes = (n: number) => ({
  companies: n,
  companiesWithContacts: Math.round((n * 2) / 3),
  openDeals: Math.round(n / 3),
  closedDeals: Math.round(n / 5),
  calls: Math.round((n * 4) / 3),
  emails: Math.round((n * 5) / 3),
  timeline: Math.round((n * 8) / 3),
  tasks: Math.round((n * 2) / 3),
  notes: Math.round(n / 3),
  meetings: Math.round(n / 10),
  proposals: Math.round(n / 20),
  runs: Math.round(n / 7.5),
  notifications: 200,
});

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Vikram", "Ananya", "Arjun", "Sneha", "Dev", "Kavya", "Neha", "Rahul", "Pooja", "Amit", "Riya", "Karan", "Tara", "Nikhil"];
const LAST = ["Shah", "Iyer", "Mehta", "Rao", "Kapoor", "Nair", "Smith", "Gupta", "Patel", "Reddy", "Das", "Joshi", "Khan", "Singh", "Menon", "Bose", "Verma", "Pillai", "Sethi", "Malik"];
const INDUSTRIES = ["Robotics", "Food & Beverage", "Healthcare", "Logistics", "Retail", "Fintech", "Construction", "Textiles", "SaaS", "Education", "Energy", "Media"];
const CITIES = ["Pune", "Bengaluru", "Mumbai", "Chennai", "Delhi", "Hyderabad", "Ahmedabad", "Surat", "Kolkata", "Jaipur"];
const OPEN_STAGES = ["new", "ready_for_first_call", "contact_attempted", "not_connected_nurture", "connected_qualifying", "interested_later", "future_possibility", "meeting_scheduling", "meeting_scheduled", "meeting_follow_up", "proposal_preparation", "proposal_sent", "proposal_decision_pending", "negotiation"];
const arr = (values: string[]) => `(array[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")}])`;
const pick = (values: string[], g: string) => `${arr(values)}[1 + ((${g}) % ${values.length})]`;
const daysAgo = (expr: string) => `(now() - ((${expr}) * interval '1 day') - ((g % 1440) * interval '1 minute'))`;

/** Drops everything the harness made before and applies the stand-ins + every migration. */
export async function resetDatabase(db: Client) {
  await db.query(`drop schema if exists crm cascade; drop schema if exists auth cascade;
    drop table if exists public.revenueos_profiles, public.revenueos_projects cascade;`);
  // Roles are cluster-wide; drop the ones migrations create so they can run again.
  await db.query(`do $$ declare r text; begin
      foreach r in array array['crm_app', 'anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('drop owned by %I', r);
          execute format('drop role %I', r);
        end if;
      end loop;
    end $$;`);
  await db.query(SUPABASE_STANDINS);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

async function seedUsers(db: Client) {
  for (const u of USERS) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [u.id, u.email]);
    await db.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [u.id, u.name, u.email]);
    await db.query(`insert into crm.profiles (id, role) values ($1, $2)`, [u.id, u.role]);
  }
}

async function seedWorkspace(db: Client, spec: WorkspaceSpec) {
  const { key: k, contacts: n } = spec;
  const s = sizes(n);
  const ws = `'${wsId(k)}'::uuid`;
  const contact = (g: string) => sqlUid(k, "ct", g);
  const company = (g: string) => sqlUid(k, "co", g);
  const deal = (g: string) => sqlUid(k, "dl", g);
  // Contact c works at company ((c - 1) % companiesWithContacts) + 1; the open deal of contact c (c <= openDeals) is deal c.
  const companyOf = (c: string) => `((${c} - 1) % ${s.companiesWithContacts}) + 1`;
  const q = (sql: string) => db.query(sql);

  await db.query(`insert into crm.workspaces (id, name, slug, default_owner_id) values ($1, $2, $3, $4)`, [wsId(k), spec.name, `load-${k.toLowerCase()}`, SALES_IDS[0]]);
  await db.query(`insert into crm.workspace_members (workspace_id, user_id) select $1, unnest($2::uuid[])`, [wsId(k), SALES_IDS]);

  await q(`insert into crm.companies (id, workspace_id, name, domain, website, industry, city, country, headcount, owner_id, source, created_at)
    select ${company("g")}, ${ws}, ${pick(INDUSTRIES, "g")} || ' Co ' || g, 'company-' || g || '.example', 'https://company-' || g || '.example',
           ${pick(INDUSTRIES, "g")}, ${pick(CITIES, "g / 3")}, 'India', 10 + (g % 500), ${OWNER("g")}, 'brain', ${daysAgo("g % 120")}
      from generate_series(1, ${s.companies}) g`);

  await q(`insert into crm.contacts (id, workspace_id, company_id, first_name, last_name, job_title, email, phone, phone_e164, owner_id, source,
                                     status, dnc_reason, dnc_at, lifecycle_stage, country, last_activity_at, created_at)
    select ${contact("g")}, ${ws}, ${company(companyOf("g"))}, ${pick(FIRST, "g")}, ${pick(LAST, "g / 20")}, ${pick(["Head of Sales", "VP Marketing", "Founder", "Growth Lead", "CTO"], "g")},
           lower(${pick(FIRST, "g")} || '.' || ${pick(LAST, "g / 20")} || g || '@company-' || (${companyOf("g")}) || '.example'),
           '+9190' || lpad(g::text, 8, '0'), '+9190' || lpad(g::text, 8, '0'), ${OWNER("g")}, 'brain',
           case when g % 50 = 0 then 'do_not_contact'::crm.contact_status else 'active' end,
           case when g % 50 = 0 then 'Asked not to be contacted' end,
           case when g % 50 = 0 then ${daysAgo("g % 60")} end,
           case when g <= ${s.openDeals} then 'qualified'::crm.lifecycle_stage
                when g <= ${s.openDeals + s.closedDeals} and g % 4 = 0 then 'customer'
                else ${pick(["prospect", "prospect", "prospect", "prospect", "prospect", "contacted", "contacted", "contacted", "engaged", "engaged"], "g")}::crm.lifecycle_stage end,
           'India', ${daysAgo("(g * 7) % 90")}, ${daysAgo("g % 120")}
      from generate_series(1, ${n}) g`);

  await q(`insert into crm.contact_channels (contact_id, channel, status)
    select ${contact("g")}, 'email'::crm.contact_channel, case when g % 33 = 0 then 'permanent_bounce' when g % 29 = 0 then 'unsubscribed' else 'valid' end from generate_series(1, ${n}) g
    union all
    select ${contact("g")}, 'phone'::crm.contact_channel, 'valid' from generate_series(1, ${n}) g`);
  await q(`insert into crm.dnc_events (contact_id, action, reason, actor_name, created_at)
    select ${contact("g")}, 'suppressed', 'Asked not to be contacted', 'Sam Sales', ${daysAgo("g % 60")} from generate_series(50, ${n}, 50) g`);
  await q(`insert into crm.external_refs (workspace_id, contact_id, source, external_id) select ${ws}, ${contact("g")}, 'quickicp', 'p-' || g from generate_series(1, ${n}) g`);
  await q(`insert into crm.external_refs (workspace_id, company_id, source, external_id) select ${ws}, ${company("g")}, 'quickicp', 'co-' || g from generate_series(1, ${s.companies}) g`);

  await q(`insert into crm.deals (id, workspace_id, contact_id, company_id, owner_id, stage, outcome, automation_mode, amount, last_activity_at, created_at)
    select ${deal("g")}, ${ws}, ${contact("g")}, ${company(companyOf("g"))}, ${OWNER("g")}, ${pick(OPEN_STAGES, "g")}::crm.pipeline_stage, 'open',
           case when g % 4 = 0 then 'active'::crm.automation_mode else 'manual' end,
           case when g % 5 < 3 then ((g % 50) + 1) * 10000 end, ${daysAgo("(g * 3) % 60")}, ${daysAgo("g % 90")}
      from generate_series(1, ${s.openDeals}) g`);
  await q(`insert into crm.deals (id, workspace_id, contact_id, company_id, owner_id, stage, outcome, loss_reason, amount, closed_at, last_activity_at, created_at)
    select ${deal("g")}, ${ws}, ${contact("g")}, ${company(companyOf("g"))}, ${OWNER("g")}, 'negotiation',
           ${pick(["won", "lost", "nurture", "discarded"], "g")}::crm.deal_outcome,
           case when g % 4 = 1 then 'no_response'::crm.loss_reason end,
           case when g % 5 < 3 then ((g % 50) + 1) * 10000 end, ${daysAgo("g % 100")}, ${daysAgo("g % 100")}, ${daysAgo("100 + g % 60")}
      from generate_series(${s.openDeals + 1}, ${s.openDeals + s.closedDeals}) g`);

  // Activity rows spread over every contact; rows for contacts with an open deal point at it.
  const c = `(1 + (g % ${n}))`;
  const dealOf = `case when ${c} <= ${s.openDeals} then ${deal(c)} end`;
  await q(`insert into crm.calls (workspace_id, contact_id, deal_id, salesperson_id, source, connected, not_connected_reason, connected_outcome,
                                  ai_outcome, summary, duration_seconds, occurred_at, created_at, external_source, external_id)
    select ${ws}, ${contact(c)}, ${dealOf},
           case when g % 2 = 0 then ${OWNER("g")} end,
           case when g % 2 = 0 then 'human'::crm.call_source else 'ai' end,
           g % 3 = 0,
           case when g % 2 = 0 and g % 3 <> 0 then 'no_answer'::crm.call_not_connected_reason end,
           case when g % 2 = 0 and g % 3 = 0 then 'positive'::crm.call_connected_outcome end,
           case when g % 2 = 1 then ${pick(["interested", "not_now", "no_answer", "voicemail"], "g")} end,
           case when g % 2 = 1 then 'AI call summary ' || g end,
           case when g % 3 = 0 then 60 + g % 300 else 0 end, ${daysAgo("g % 60")}, ${daysAgo("g % 60")},
           case when g % 2 = 1 then 'quickhowl' end, case when g % 2 = 1 then 'call-' || g end
      from generate_series(1, ${s.calls}) g`);
  await q(`insert into crm.email_activities (workspace_id, contact_id, deal_id, external_source, external_id, campaign_ref, campaign_name, step, subject,
                                             status, reply_text, sent_at, opened_at, replied_at, created_at)
    select ${ws}, ${contact(c)}, ${dealOf}, 'email_tool', 'em-' || g, 'camp-' || (g % 5), 'Campaign ' || (g % 5), 1 + g % 3, 'Quick question about your pipeline',
           case when g % 10 = 0 then 'replied'::crm.email_status when g % 10 in (1, 2) then 'opened' else 'sent' end,
           case when g % 10 = 0 then 'Thanks, tell me more about pricing.' end,
           ${daysAgo("g % 30")}, case when g % 10 in (0, 1, 2) then ${daysAgo("g % 20")} end, case when g % 10 = 0 then ${daysAgo("g % 10")} end, ${daysAgo("g % 30")}
      from generate_series(1, ${s.emails}) g`);
  await q(`insert into crm.timeline_events (workspace_id, company_id, contact_id, deal_id, occurred_at, event_kind, title, detail, actor_name, actor_source)
    select ${ws}, ${company(companyOf(c))}, ${contact(c)}, ${dealOf}, ${daysAgo("g % 90")},
           ${pick(["note", "call", "email", "system", "stage_change", "whatsapp"], "g")},
           ${pick(["Note added", "Call logged", "Email sent", "Contact updated", "Stage changed", "WhatsApp sent"], "g")}, 'Load test event ' || g,
           'Sam Sales', ${pick(["user", "system", "brain", "automation"], "g / 6")}::crm.actor_source
      from generate_series(1, ${s.timeline}) g`);
  // Two tasks per open deal; 40% done, the rest open: overdue, due today (IST) or upcoming.
  const d = `(1 + (g % ${s.openDeals}))`;
  await q(`insert into crm.tasks (workspace_id, deal_id, contact_id, owner_id, task_type, title, due_at, status, completed_at)
    select ${ws}, ${deal(d)}, ${contact(d)}, ${OWNER("g")}, ${pick(["call", "follow_up", "send_email"], "g")}::crm.task_type, 'Task ' || g,
           case when g % 5 in (0, 1) then ${daysAgo("g % 30")}
                when g % 10 = 2 then ${daysAgo("1 + g % 20")}
                when g % 10 = 3 then (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') + ((g % 12 + 9) * interval '1 hour')
                else now() + ((1 + g % 30) * interval '1 day') end,
           case when g % 5 in (0, 1) then 'completed'::crm.task_status else 'open' end,
           case when g % 5 in (0, 1) then ${daysAgo("g % 30")} end
      from generate_series(1, ${s.tasks}) g`);
  await q(`insert into crm.notes (workspace_id, contact_id, deal_id, author_id, body, created_at)
    select ${ws}, ${contact(c)}, ${dealOf}, ${OWNER("g")}, 'Load test note ' || g, ${daysAgo("g % 90")} from generate_series(1, ${s.notes}) g`);
  await q(`insert into crm.meetings (workspace_id, deal_id, owner_id, title, scheduled_at, status)
    select ${ws}, ${deal(d)}, ${OWNER("g")}, 'Meeting ' || g, now() + (((g % 60) - 30) * interval '1 day') + ((g % 8) * interval '1 hour'),
           ${pick(["scheduled", "confirmed", "completed", "cancelled"], "g")}::crm.meeting_status
      from generate_series(1, ${s.meetings}) g`);
  await q(`insert into crm.proposals (workspace_id, deal_id, owner_id, title, amount, status, sent_at)
    select ${ws}, ${deal(d)}, ${OWNER("g")}, 'Proposal ' || g, ((g % 40) + 1) * 25000, st, case when st in ('sent', 'revision_requested', 'revised', 'accepted', 'withdrawn') then ${daysAgo("g % 30")} end
      from generate_series(1, ${s.proposals}) g,
           lateral (select ${pick(["draft", "uploaded", "ready_to_send", "sent", "sent", "revision_requested", "revised", "accepted", "withdrawn"], "g")}::crm.proposal_status as st) x`);
  await q(`insert into crm.notifications (workspace_id, recipient_id, contact_id, title, read, created_at)
    select ${ws}, '${SALES_IDS[0]}', ${contact("g")}, 'Notification ' || g, g % 3 = 0, ${daysAgo("g % 10")} from generate_series(1, ${s.notifications}) g`);

  // One published workflow (email, then a follow-up task); one waiting run + pending action per early open deal.
  const tpl = uid(k, "tpl", 1);
  const wf = uid(k, "wf", 1);
  const ver = uid(k, "ver", 1);
  const step = uid(k, "step", 0);
  await db.query(`insert into crm.message_templates (id, workspace_id, name, channel, subject, body) values ($1, $2, 'Nurture 1', 'email', 'Following up', '<p>Hi {{contact.first_name}}</p>')`, [tpl, wsId(k)]);
  await db.query(`insert into crm.workflows (id, workspace_id, name, trigger, status) values ($1, $2, 'Nurture', 'deal_created', 'active')`, [wf, wsId(k)]);
  await db.query(`insert into crm.workflow_versions (id, workspace_id, workflow_id, version_number) values ($1, $2, $3, 1)`, [ver, wsId(k), wf]);
  await db.query(
    `insert into crm.workflow_steps (id, workspace_id, workflow_version_id, step_order, delay_days, action, template_id)
     values ($1, $2, $3, 0, 0, 'send_email', $4), ($5, $2, $3, 1, 2, 'create_follow_up_task', null)`,
    [step, wsId(k), ver, tpl, uid(k, "step", 1)],
  );
  await db.query(`update crm.workflow_versions set status = 'published', published_at = now() where id = $1`, [ver]);
  await q(`insert into crm.workflow_runs (id, workspace_id, workflow_id, workflow_version_id, deal_id, contact_id, current_step_id, status, next_run_at)
    select ${sqlUid(k, "run", "g")}, ${ws}, '${wf}', '${ver}', ${deal("g")}, ${contact("g")}, '${step}', 'waiting', now() + ((1 + g % 14) * interval '1 day')
      from generate_series(1, ${s.runs}) g`);
  await q(`insert into crm.scheduled_actions (workspace_id, deal_id, workflow_run_id, workflow_step_id, action_type, scheduled_for)
    select ${ws}, ${deal("g")}, ${sqlUid(k, "run", "g")}, '${step}', 'send_email', now() + ((1 + g % 14) * interval '1 day')
      from generate_series(1, ${s.runs}) g`);
}

/** Resets and seeds; returns row counts per table for the report. */
export async function seedLoadDb(db: Client) {
  await resetDatabase(db);
  await seedUsers(db);
  for (const spec of WORKSPACES) await seedWorkspace(db, spec);
  await db.query(`vacuum analyze`);
  return tableCounts(db);
}

export async function tableCounts(db: Client) {
  const tables = ["companies", "contacts", "contact_channels", "external_refs", "deals", "calls", "email_activities", "timeline_events", "tasks", "notes", "meetings", "proposals", "workflow_runs", "scheduled_actions"];
  const r = await db.query<Record<string, number>>(`select ${tables.map((t) => `(select count(*)::int from crm.${t}) as ${t}`).join(", ")}`);
  return r.rows[0]!;
}
