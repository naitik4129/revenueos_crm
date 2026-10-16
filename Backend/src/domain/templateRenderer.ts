/**
 * Renders a message_templates row's subject/body against a contact, its company and deal for a
 * send_email/send_whatsapp step. This is the single source of truth for
 * which `{{...}}` variables exist (TEMPLATE_VARIABLES below) — src/worker.ts uses it to render
 * outbound messages, workflows.service.ts's publishVersion uses findUnknownTemplateTokens to
 * refuse publishing a version whose templates reference anything else, and the frontend picker
 * and preview read it through GET /templates/variables and POST /templates/preview.
 *
 * `body` is HTML authored by the template rich-text editor; substituted
 * variable values are HTML-escaped so a contact field containing `<`, `&`, `"`
 * etc. can't break the surrounding markup or inject new tags. The template's
 * own authored HTML is never touched — only the matched `{{...}}` span is
 * replaced.
 *
 * Pure and side-effect-free: unknown tokens are left in the output as-is
 * (never silently blanked) and reported back via `unknownTokens` so the
 * caller decides what to do.
 */

/** What a template is rendered against: {{contact.*}}, {{company.*}}, {{deal.*}}. */
export interface TemplateRenderContext {
  contact: { firstName: string; lastName: string; email: string | null; phone: string | null; jobTitle: string | null };
  company: { name: string | null; industry: string | null; website: string | null };
  deal: { stage: string | null; serviceInterest: string | null; ownerName: string | null };
}

/** Meeting context for a "meeting scheduled" notification — see meetingScheduledNotification.service.ts. Optional on renderTemplate since most templates render without one. */
export interface TemplateRenderMeeting {
  title: string;
  /** ISO instant — formatted into date/time tokens in Asia/Kolkata, matching this app's single-tenant timezone (Frontend/src/lib/dates.ts). */
  at: string;
  durationMin: number;
  link: string | null;
}

export interface RenderableTemplate {
  subject: string | null;
  body: string;
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  unknownTokens: string[];
}

const MEETING_TIME_ZONE = "Asia/Kolkata";

function formatMeetingDate(at: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: MEETING_TIME_ZONE, dateStyle: "medium" }).format(new Date(at));
}

function formatMeetingTime(at: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: MEETING_TIME_ZONE, timeStyle: "short" }).format(new Date(at));
}

const humanize = (value: string | null) => (value ? value.replaceAll("_", " ") : "");

function buildVariableMap(ctx: TemplateRenderContext, meeting: TemplateRenderMeeting | undefined, now: Date): Map<string, string> {
  const { contact, company, deal } = ctx;
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  // A Map (not a plain object) so a token like "constructor" or "toString"
  // can't accidentally resolve via JS's Object.prototype chain instead of
  // being correctly reported as unknown.
  return new Map([
    ["contact.firstName", contact.firstName],
    ["contact.lastName", contact.lastName],
    ["contact.fullName", fullName || contact.firstName],
    ["contact.email", contact.email ?? ""],
    ["contact.phone", contact.phone ?? ""],
    ["contact.jobTitle", contact.jobTitle ?? ""],
    ["company.name", company.name ?? ""],
    ["company.industry", company.industry ?? ""],
    ["company.website", company.website ?? ""],
    ["deal.stage", humanize(deal.stage)],
    ["deal.serviceInterest", deal.serviceInterest ?? ""],
    ["deal.ownerName", deal.ownerName ?? ""],
    ["current.date", formatMeetingDate(now.toISOString())],
    ["tomorrow.date", formatMeetingDate(new Date(now.getTime() + 86_400_000).toISOString())],
    ["current.time", formatMeetingTime(now.toISOString())],
    ...(meeting
      ? ([
          ["meeting.title", meeting.title],
          ["meeting.date", formatMeetingDate(meeting.at)],
          ["meeting.time", formatMeetingTime(meeting.at)],
          ["meeting.duration", `${meeting.durationMin} minutes`],
          ["meeting.link", meeting.link ?? ""],
        ] as const)
      : []),
  ]);
}

export type TemplateVariableGroup = "contact" | "company" | "deal" | "meeting" | "date";

/**
 * Every `{{...}}` token this renderer fills, with its picker label and group: the one list behind
 * publish-time validation (findUnknownTemplateTokens) and the frontend picker
 * (GET /templates/variables).
 *
 * Meeting variables require the specific meeting from the meeting-scheduled
 * notification path. Rendering fails without that context, so unrelated
 * workflow/proposal sends cannot send unresolved meeting placeholders.
 * Current/tomorrow values use one send-time instant in Asia/Kolkata (fixed
 * UTC+05:30, no daylight saving), matching the application's calendar.
 */
export const TEMPLATE_VARIABLES = [
  { token: "contact.firstName", label: "First name", group: "contact" },
  { token: "contact.lastName", label: "Last name", group: "contact" },
  { token: "contact.fullName", label: "Full name", group: "contact" },
  { token: "contact.email", label: "Email", group: "contact" },
  { token: "contact.phone", label: "Phone", group: "contact" },
  { token: "contact.jobTitle", label: "Job title", group: "contact" },
  { token: "company.name", label: "Company name", group: "company" },
  { token: "company.industry", label: "Industry", group: "company" },
  { token: "company.website", label: "Website", group: "company" },
  { token: "deal.stage", label: "Deal stage", group: "deal" },
  { token: "deal.serviceInterest", label: "Service interest", group: "deal" },
  { token: "deal.ownerName", label: "Deal owner", group: "deal" },
  { token: "meeting.title", label: "Meeting title", group: "meeting" },
  { token: "meeting.date", label: "Meeting date", group: "meeting" },
  { token: "meeting.time", label: "Meeting time", group: "meeting" },
  { token: "meeting.duration", label: "Meeting duration", group: "meeting" },
  { token: "meeting.link", label: "Meeting link", group: "meeting" },
  { token: "current.date", label: "Today's date", group: "date" },
  { token: "tomorrow.date", label: "Tomorrow's date", group: "date" },
  { token: "current.time", label: "Current time", group: "date" },
] as const satisfies readonly { token: string; label: string; group: TemplateVariableGroup }[];

export const KNOWN_TEMPLATE_VARIABLES = TEMPLATE_VARIABLES.map((v) => v.token);
const KNOWN = new Set<string>(KNOWN_TEMPLATE_VARIABLES);

const TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/** Unfilled tokens stay in the text as typed (never silently blanked); onMissing records them. */
function renderText(text: string, variables: Map<string, string>, onMissing: (key: string) => void, escape: boolean): string {
  return text.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = variables.get(key);
    if (value !== undefined) return escape ? escapeHtml(value) : value;
    onMissing(key);
    return match;
  });
}

export function renderTemplate(template: RenderableTemplate, ctx: TemplateRenderContext, meeting?: TemplateRenderMeeting, now = new Date()): RenderedTemplate {
  const meetingTokens = [...`${template.subject ?? ""}\n${template.body}`.matchAll(TOKEN_PATTERN)]
    .map((match) => match[1]!)
    .filter((key) => key.startsWith("meeting.") && KNOWN.has(key));
  if (meetingTokens.length && !meeting) {
    throw new Error("Meeting variables require a scheduled meeting. Use this template for Meeting Scheduled notifications.");
  }
  const variables = buildVariableMap(ctx, meeting, now);
  const unknownTokens = new Set<string>();
  const onMissing = (key: string) => unknownTokens.add(key);
  // body is HTML (see module doc-comment above) — escape substituted values.
  // subject is a plain-text email header — substitute as-is, never escaped.
  const body = renderText(template.body, variables, onMissing, true);
  const subject = template.subject != null ? renderText(template.subject, variables, onMissing, false) : null;
  return { subject, body, unknownTokens: [...unknownTokens] };
}

export type MissingReason = "unknown" | "needs_deal" | "needs_meeting";

export interface TemplatePreview {
  subject: string | null;
  body: string;
  /** Tokens left unfilled (still `{{...}}` in the output), each once, in order of appearance. */
  missing: { token: string; reason: MissingReason }[];
}

/**
 * Editor preview: like renderTemplate, but never throws. With no deal, deal.* stay unfilled
 * ("needs_deal"); with no meeting, meeting.* stay unfilled ("needs_meeting"); a token not in
 * TEMPLATE_VARIABLES is "unknown". Real sends always have a deal; meeting.* only render in
 * Meeting Scheduled notifications.
 */
export function previewTemplate(
  template: RenderableTemplate,
  ctx: Omit<TemplateRenderContext, "deal"> & { deal: TemplateRenderContext["deal"] | null },
  meeting: TemplateRenderMeeting | null,
  now = new Date(),
): TemplatePreview {
  const deal = ctx.deal ?? { stage: null, serviceInterest: null, ownerName: null };
  const variables = buildVariableMap({ ...ctx, deal }, meeting ?? undefined, now);
  if (!ctx.deal) for (const key of [...variables.keys()]) if (key.startsWith("deal.")) variables.delete(key);
  const missing = new Map<string, MissingReason>();
  const onMissing = (key: string) => {
    if (missing.has(key)) return;
    missing.set(key, !KNOWN.has(key) ? "unknown" : key.startsWith("deal.") ? "needs_deal" : "needs_meeting");
  };
  const subject = template.subject != null ? renderText(template.subject, variables, onMissing, false) : null;
  const body = renderText(template.body, variables, onMissing, true);
  return { subject, body, missing: [...missing].map(([token, reason]) => ({ token, reason })) };
}

/** Publish-time check: which `{{...}}` tokens in this text aren't in KNOWN_TEMPLATE_VARIABLES, without needing a real contact to render against. */
export function findUnknownTemplateTokens(text: string): string[] {
  const unknownTokens = new Set<string>();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const key = match[1]!;
    if (!KNOWN.has(key)) unknownTokens.add(key);
  }
  return [...unknownTokens];
}
