/**
 * DEMO MODE ONLY. Seeds the local PGlite database with two client workspaces of realistic data,
 * mostly through the real service functions so timelines, lifecycle stages and next actions
 * look like real use. Dates are relative to now, so "today" is always today.
 *
 * Imported by demo/start.ts only after the demo environment is set and checked.
 */
import type { Actor } from "../src/authMiddleware.js";
import { pool } from "../src/db.js";
import { applyHandover, upsertCall, upsertCompany, upsertContact, upsertEmailEvent } from "../src/services/brain.service.js";
import { createCompany } from "../src/services/companies.service.js";
import { addNote, createContact, markDnc, mergeContacts } from "../src/services/contacts.service.js";
import { createDeal, markDiscarded, markLost, markWon, moveToNurture, updateDeal } from "../src/services/deals.service.js";
import { logCall } from "../src/services/calls.service.js";
import { createTask } from "../src/services/tasks.service.js";
import { createBrainKey, revokeBrainKey } from "../src/services/brain-keys.service.js";
import { scheduleMeeting } from "../src/services/meetings.service.js";
import { createProposal } from "../src/services/proposals.service.js";
import { DEMO_USERS, type DemoUserInfo as SeedUser } from "./users.js";

const actorOf = (u: SeedUser): Actor => ({ id: u.id, fullName: u.name, email: u.email, isActive: true, role: u.role });
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursFromNow(-24 * d);

const TRANSCRIPT = `AI: Hi, this is Maya calling from MOTM about your outbound pipeline. Is now a good time?
Prospect: Sure, I have a couple of minutes.
AI: Many logistics teams we work with struggle to keep a steady flow of qualified meetings. How do you generate new accounts today?
Prospect: Mostly referrals and a part-time SDR. It's patchy.
AI: Would a short call with our team next week make sense to see if we can help?
Prospect: Yes, send me a few times. Thursday works best.
AI: Great, I'll have the team reach out. Thanks for your time!`;

export async function seedDemo() {
  const [admin, sam, priya] = DEMO_USERS as [SeedUser, SeedUser, SeedUser];
  for (const u of DEMO_USERS) {
    await pool.query(`insert into auth.users (id, email) values ($1, $2)`, [u.id, u.email]);
    await pool.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [u.id, u.name, u.email]);
    await pool.query(`insert into crm.profiles (id, role) values ($1, $2)`, [u.id, u.role]);
  }
  const ws = async (name: string, slug: string) =>
    (await pool.query<{ id: string }>(`insert into crm.workspaces (name, slug) values ($1, $2) returning id`, [name, slug])).rows[0]!.id;
  const acme = await ws("Acme Client", "acme-client");
  const globex = await ws("Globex Client", "globex-client");
  // Sam works on both clients, Priya on Acme only; the admin needs no membership.
  await pool.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $3), ($2, $3), ($1, $4)`, [acme, globex, sam.id, priya.id]);
  await pool.query(`update crm.workspaces set default_owner_id = $2 where id = $1`, [acme, sam.id]);

  // For the admin tabs: a deactivated salesperson (not on the login picker) and brain keys, one revoked.
  const ravi = "d0000000-0000-4000-8000-000000000004";
  await pool.query(`insert into auth.users (id, email) values ($1, 'ravi@demo.local')`, [ravi]);
  await pool.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, 'Ravi Former', 'ravi@demo.local')`, [ravi]);
  await pool.query(`insert into crm.profiles (id, role, is_active) values ($1, 'salesperson', false)`, [ravi]);
  await pool.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2)`, [globex, ravi]);
  await createBrainKey(actorOf(admin), acme, "RevenueOS brain");
  await createBrainKey(actorOf(admin), globex, "RevenueOS brain");
  const old = await createBrainKey(actorOf(admin), globex, "Old brain key");
  await revokeBrainKey(actorOf(admin), globex, old.id);

  await seedAcme(acme, actorOf(sam), actorOf(priya));
  await seedGlobex(globex, actorOf(sam));
  const counts = await pool.query<{ contacts: number; companies: number; deals: number }>(
    `select (select count(*)::int from crm.contacts) as contacts, (select count(*)::int from crm.companies) as companies,
            (select count(*)::int from crm.deals) as deals`,
  );
  return counts.rows[0]!;
}

async function seedAcme(ws: string, sam: Actor, priya: Actor) {
  // --- Companies: six found by the brain (QuickICP), two added by hand ---------------------
  const brainCompanies = [
    ["co-1", "Kilo Robotics", "kilorobotics.io", "Robotics", "Pune", 120],
    ["co-2", "Lima Foods", "limafoods.in", "Food & Beverage", "Bengaluru", 300],
    ["co-3", "Nova Health", "novahealth.co", "Healthcare", "Mumbai", 80],
    ["co-4", "Orbit Logistics", "orbitlogistics.com", "Logistics", "Chennai", 450],
    ["co-5", "Pixel Retail", "pixelretail.store", "Retail", "Delhi", 60],
    ["co-6", "Quartz Fintech", "quartzfin.com", "Fintech", "Hyderabad", 200],
  ] as const;
  for (const [externalId, name, domain, industry, city, headcount] of brainCompanies) {
    await upsertCompany(pool, ws, { source: "quickicp", externalId, name, website: `https://www.${domain}`, industry, city, country: "India", headcount });
  }
  await createCompany(pool, sam, ws, { name: "Redwood Builders", website: "redwoodbuilders.in", industry: "Construction", city: "Ahmedabad", country: "India", headcount: 90 });
  await createCompany(pool, priya, ws, { name: "Sierra Textiles", website: "sierratextiles.com", industry: "Textiles", city: "Surat", country: "India", headcount: 150 });

  // --- 24 brain prospects across the six companies ---------------------------------------
  const first = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Vikram", "Ananya", "Arjun", "Sneha", "Dev", "Kavya"];
  const last = ["Shah", "Iyer", "Mehta", "Rao", "Kapoor", "Nair"];
  const titles = ["Head of Sales", "VP Marketing", "Founder", "Growth Lead"];
  const person = (i: number) => ({ source: "quickicp" as const, externalId: `p-${i}` });
  for (let i = 0; i < 24; i++) {
    const [, , domain] = brainCompanies[i % 6]!;
    const firstName = first[i % first.length]!;
    const lastName = last[(i * 5) % last.length]!;
    await upsertContact(pool, ws, {
      ...person(i),
      firstName,
      lastName,
      jobTitle: titles[i % titles.length],
      email: `${firstName}.${lastName}${i}@${domain}`.toLowerCase(),
      phone: `+9198${String(76543210 + i * 7919).padStart(8, "0")}`,
      country: "India",
      companyRef: { source: "quickicp", externalId: brainCompanies[i % 6]![0] },
    });
  }

  // --- Campaign emails (Email Tool) and AI calls (Quickhowl) ------------------------------
  // p-0..p-9 got step 1; some opened, some replied, one bounced. Prospects p-18..p-23 stay untouched.
  for (let i = 0; i < 10; i++) {
    const email = { source: "email_tool" as const, messageId: `m-${i}`, contact: person(i), campaignRef: "q4-outbound", campaignName: "Q4 outbound", step: 1, subject: "Quick question about your pipeline" };
    await upsertEmailEvent(pool, ws, { ...email, event: "sent", occurredAt: daysAgo(6 - (i % 5)) });
    if (i % 3 === 0) await upsertEmailEvent(pool, ws, { ...email, event: "opened", occurredAt: daysAgo(3) });
    if (i === 3 || i === 6) {
      await upsertEmailEvent(pool, ws, { ...email, event: "replied", occurredAt: daysAgo(2), replyText: "Thanks for reaching out. We are exploring this for next quarter. Can you share some case studies?" });
    }
    if (i === 9) await upsertEmailEvent(pool, ws, { ...email, event: "bounced", occurredAt: daysAgo(5) });
  }
  const aiCalls = [
    { i: 10, connected: true, outcome: "interested", summary: "Interested in outbound support; asked for a call on Thursday.", transcript: TRANSCRIPT, durationSeconds: 184, sentiment: "positive" },
    { i: 11, connected: true, outcome: "not_now", summary: "Busy this quarter; open to a follow-up in January.", durationSeconds: 95, sentiment: "neutral" },
    { i: 12, connected: false, outcome: "no_answer", durationSeconds: 0 },
    { i: 13, connected: false, outcome: "voicemail", durationSeconds: 22 },
    { i: 14, connected: true, outcome: "interested", summary: "Wants pricing for a 3-month pilot.", transcript: TRANSCRIPT, durationSeconds: 241, sentiment: "positive" },
  ];
  for (const c of aiCalls) {
    const { i, ...call } = c;
    await upsertCall(pool, ws, { source: "quickhowl", externalId: `call-${i}`, contact: person(i), direction: "outbound", startedAt: daysAgo(1 + (i % 3)), ...call });
  }
  // An AI call where the person asked not to be called again -> DNC.
  await upsertCall(pool, ws, { source: "quickhowl", externalId: "call-15", contact: person(15), connected: true, outcome: "do_not_call", dnc: true, summary: "Asked to be removed from all lists.", durationSeconds: 31, startedAt: daysAgo(2) });

  // --- Qualified handovers -> open deals owned by Sam and Priya ----------------------------
  const handover = (i: number, ownerEmail: string, summary: string) =>
    applyHandover(pool, ws, { source: "quickicp", externalId: `h-${i}`, contact: person(i), ownerEmail, summary });
  const kiloDeal = (await handover(10, "sam@demo.local", "Interested in outbound support; meeting requested for Thursday.")).id!;
  const orbitDeal = (await handover(14, "priya@demo.local", "Wants pricing for a 3-month pilot.")).id!;
  const novaDeal = (await handover(3, "sam@demo.local", "Replied to the campaign asking for case studies.")).id!;
  const quartzDeal = (await handover(6, "priya@demo.local", "Replied: exploring for next quarter.")).id!;

  // Move them along the pipeline, with a meeting today and a proposal awaiting a decision.
  await updateDeal(pool, sam, ws, kiloDeal, { stage: "meeting_scheduled", serviceInterest: "Outbound lead generation" });
  await scheduleMeeting(pool, sam, ws, { dealId: kiloDeal, title: "Discovery call - Kilo Robotics", at: hoursFromNow(3), durationMin: 30, url: "https://meet.example.com/kilo" });
  await updateDeal(pool, priya, ws, orbitDeal, { stage: "proposal_sent", serviceInterest: "3-month outbound pilot" });
  const proposal = await createProposal(pool, priya, ws, { dealId: orbitDeal, title: "Orbit Logistics - 3-month pilot", amount: 450000, notes: "Pilot: 2 SDRs, LinkedIn + email + calling." });
  await pool.query(`update crm.proposals set status = 'sent', sent_at = $2, follow_up_at = $3 where id = $1`, [proposal.id, daysAgo(2), hoursFromNow(24)]);
  await updateDeal(pool, sam, ws, novaDeal, { stage: "connected_qualifying", serviceInterest: "Account-based marketing" });

  // --- Hand-made contacts, deals and human calls --------------------------------------------
  const company = async (name: string) =>
    (await pool.query<{ id: string }>(`select id from crm.companies where workspace_id = $1 and name = $2`, [ws, name])).rows[0]!.id;
  const redwood = await company("Redwood Builders");
  const sierra = await company("Sierra Textiles");
  const hand = (actor: Actor, firstName: string, lastName: string, email: string, companyId: string, jobTitle: string) =>
    createContact(pool, actor, ws, { firstName, lastName, email, companyId, jobTitle, source: "referral" });
  const neha = await hand(sam, "Neha", "Joshi", "neha@redwoodbuilders.in", redwood, "Managing Director");
  const farhan = await hand(sam, "Farhan", "Ali", "farhan@redwoodbuilders.in", redwood, "Sales Manager");
  const lata = await hand(priya, "Lata", "Desai", "lata@sierratextiles.com", sierra, "CEO");
  const omar = await hand(priya, "Omar", "Khan", "omar@sierratextiles.com", sierra, "Export Head");
  const tara = await hand(sam, "Tara", "Bose", "tara@kilorobotics.io", await company("Kilo Robotics"), "COO");
  // A duplicate of Tara typed in by hand, merged into her.
  const taraDup = await createContact(pool, priya, ws, { firstName: "Tara", lastName: "B.", phone: "+919811122233", source: "event" });
  await mergeContacts(pool, sam, ws, taraDup.id, tara.id, "Same person, met at an event.");

  // Human calls: one opens a deal (positive), one goes to nurture, one is not connected.
  await logCall(pool, sam, ws, neha.id, { connected: true, connectedOutcome: "positive", notes: "Keen to grow site-visit bookings. Wants a meeting." });
  await logCall(pool, priya, ws, lata.id, { connected: true, connectedOutcome: "interested_later", notes: "Budget opens in April.", interestedLater: { reason: "Budget cycle", restartAt: daysAgo(-120).slice(0, 10), nextAction: "Share export case study", decisionOwner: "Lata" } });
  await logCall(pool, sam, ws, farhan.id, { connected: false, notConnectedReason: "no_answer" });
  await addNote(pool, sam, ws, neha.id, { body: "Prefers WhatsApp over email. Decision with the founder, her father." });

  // Closed deals: one won (customer), one lost, one parked in nurture, one discarded.
  const won = await createDeal(pool, priya, ws, { contactId: omar.id, serviceInterest: "Export lead generation" });
  await markWon(pool, priya, ws, won.id, "Signed a 6-month retainer.");
  const lostContact = await upsertContact(pool, ws, person(16));
  const lost = await createDeal(pool, sam, ws, { contactId: lostContact.id, serviceInterest: "Cold calling" });
  await markLost(pool, sam, ws, lost.id, "price_budget", "Went with a cheaper freelancer.");
  const nurtureContact = await upsertContact(pool, ws, person(17));
  const parked = await createDeal(pool, sam, ws, { contactId: nurtureContact.id });
  await moveToNurture(pool, sam, ws, parked.id, "Revisit after their funding round.");
  const discardContact = await upsertContact(pool, ws, person(11));
  const discarded = await createDeal(pool, priya, ws, { contactId: discardContact.id });
  await markDiscarded(pool, priya, ws, discarded.id, "Duplicate enquiry.");

  // --- Tasks: due today, overdue and later ----------------------------------------------------
  await createTask(pool, sam, ws, { dealId: novaDeal, ownerId: sam.id, type: "send_case_study", title: "Send ABM case study", dueAt: hoursFromNow(2) });
  await createTask(pool, sam, ws, { dealId: kiloDeal, ownerId: sam.id, type: "follow_up", title: "Confirm meeting agenda", dueAt: daysAgo(2) });
  await createTask(pool, priya, ws, { dealId: orbitDeal, ownerId: priya.id, type: "proposal_follow_up", title: "Follow up on pilot proposal", dueAt: daysAgo(1) });
  await createTask(pool, priya, ws, { dealId: quartzDeal, ownerId: priya.id, type: "call", title: "Discovery call", dueAt: hoursFromNow(26) });
  // Spread "first call" tasks: some overdue, so the queue and overdue counts are not all "now".
  await pool.query(`update crm.tasks set due_at = now() - interval '3 days' where workspace_id = $1 and title = 'First call' and deal_id = $2`, [ws, quartzDeal]);

  // Older activity on untouched prospects, so "last activity" varies.
  await pool.query(`update crm.contacts set last_activity_at = now() - (interval '1 day' * (random() * 20)) where workspace_id = $1 and source = 'brain'`, [ws]);
  await markDnc(pool, priya, ws, (await upsertContact(pool, ws, person(20))).id, { reason: "Asked by email to stop all contact." });

  // A notification for the admin path would be wrong (admins get none); Sam gets one more.
  await pool.query(
    `insert into crm.notifications (workspace_id, recipient_id, deal_id, title, detail, kind, href) values ($1, $2, $3, 'Meeting today', 'Discovery call - Kilo Robotics in 3 hours.', 'info', $4)`,
    [ws, sam.id, kiloDeal, `/deals/${kiloDeal}`],
  );
}

/** The second client: smaller, Sam only. Shows that each workspace's data stays separate. */
async function seedGlobex(ws: string, sam: Actor) {
  const titan = await createCompany(pool, sam, ws, { name: "Titan Motors", website: "titanmotors.in", industry: "Automotive", city: "Pune", country: "India", headcount: 900 });
  const umbra = await createCompany(pool, sam, ws, { name: "Umbra Media", website: "umbramedia.co", industry: "Media", city: "Mumbai", country: "India", headcount: 40 });
  const ravi = await createContact(pool, sam, ws, { firstName: "Ravi", lastName: "Kulkarni", email: "ravi@titanmotors.in", companyId: titan.id, jobTitle: "Head of Dealer Sales", source: "linkedin" });
  await createContact(pool, sam, ws, { firstName: "Pooja", lastName: "Menon", email: "pooja@titanmotors.in", companyId: titan.id, jobTitle: "Marketing Manager", source: "linkedin" });
  await createContact(pool, sam, ws, { firstName: "Zoya", lastName: "Sheikh", email: "zoya@umbramedia.co", companyId: umbra.id, jobTitle: "Founder", source: "event" });
  await createContact(pool, sam, ws, { firstName: "Kunal", lastName: "Verma", phone: "+919822233344", companyId: umbra.id, jobTitle: "Partnerships", source: "cold_call" });

  await upsertCall(pool, ws, { source: "quickhowl", externalId: "g-call-1", contact: { email: "zoya@umbramedia.co" }, connected: true, outcome: "interested", summary: "Wants help launching a new podcast network to brands.", durationSeconds: 156, sentiment: "positive", startedAt: daysAgo(1) });
  const deal = await createDeal(pool, sam, ws, { contactId: ravi.id, serviceInterest: "Dealer network outreach" });
  await updateDeal(pool, sam, ws, deal.id, { stage: "negotiation" });
  await pool.query(
    `insert into crm.notifications (workspace_id, recipient_id, deal_id, title, detail, kind, href) values ($1, $2, $3, 'Negotiation stalled', 'No reply from Titan Motors for 5 days.', 'warning', $4)`,
    [ws, sam.id, deal.id, `/deals/${deal.id}`],
  );
}
