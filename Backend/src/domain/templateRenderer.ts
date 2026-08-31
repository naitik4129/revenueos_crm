/**
 * Renders a message_templates row's subject/body against a lead for a
 * send_email/send_whatsapp step. This is the single source of truth for
 * which `{{...}}` variables exist — src/worker.ts uses it to render outbound
 * messages, and workflows.service.ts's publishVersion uses
 * findUnknownTemplateTokens below to refuse publishing a version whose
 * templates reference anything outside this list. (A future Frontend
 * "insert variable" / live-preview UI should mirror KNOWN_TEMPLATE_VARIABLES
 * from here rather than hardcoding its own copy.)
 *
 * `body` is HTML authored by the template rich-text editor; substituted
 * variable values are HTML-escaped so a lead field containing `<`, `&`, `"`
 * etc. can't break the surrounding markup or inject new tags. The template's
 * own authored HTML is never touched — only the matched `{{...}}` span is
 * replaced.
 *
 * Pure and side-effect-free: unknown tokens are left in the output as-is
 * (never silently blanked) and reported back via `unknownTokens` so the
 * caller decides what to do.
 */

export interface TemplateRenderLead {
  firstName: string;
  lastName: string;
  company: string;
  email: string | null;
  phone: string | null;
  ownerName: string | null;
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

function buildVariableMap(lead: TemplateRenderLead, meeting?: TemplateRenderMeeting): Map<string, string> {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  // A Map (not a plain object) so a token like "constructor" or "toString"
  // can't accidentally resolve via JS's Object.prototype chain instead of
  // being correctly reported as unknown.
  return new Map([
    ["lead.firstName", lead.firstName],
    ["lead.lastName", lead.lastName],
    ["lead.fullName", fullName || lead.firstName],
    ["lead.company", lead.company],
    ["lead.email", lead.email ?? ""],
    ["lead.phone", lead.phone ?? ""],
    ["owner.name", lead.ownerName ?? ""],
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

/**
 * The full set of `{{...}}` tokens this renderer understands — the source
 * of truth for UI variable pickers and publish-time validation (see
 * findUnknownTemplateTokens/workflows.service.ts publishVersion).
 *
 * Caveat: `meeting.*` only actually resolves when renderTemplate is called
 * with a meeting (the "meeting scheduled" notification path — see
 * meetingScheduledNotification.service.ts). A workflow-step template is
 * always rendered without one, so if such a template references
 * `{{meeting.*}}` it will still pass publish validation here but render as
 * literal, unresolved text at send time (logged as an unknown-token
 * warning in worker.ts). Accepted as a narrow, non-crashing edge case
 * rather than adding a per-render-context variable allowlist.
 */
export const KNOWN_TEMPLATE_VARIABLES = [
  "lead.firstName",
  "lead.lastName",
  "lead.fullName",
  "lead.company",
  "lead.email",
  "lead.phone",
  "owner.name",
  "meeting.title",
  "meeting.date",
  "meeting.time",
  "meeting.duration",
  "meeting.link",
] as const;

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

function renderText(text: string, variables: Map<string, string>, unknownTokens: Set<string>, escape: boolean): string {
  return text.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = variables.get(key);
    if (value !== undefined) return escape ? escapeHtml(value) : value;
    unknownTokens.add(key);
    return match;
  });
}

export function renderTemplate(template: RenderableTemplate, lead: TemplateRenderLead, meeting?: TemplateRenderMeeting): RenderedTemplate {
  const variables = buildVariableMap(lead, meeting);
  const unknownTokens = new Set<string>();
  // body is HTML (see module doc-comment above) — escape substituted values.
  // subject is a plain-text email header — substitute as-is, never escaped.
  const body = renderText(template.body, variables, unknownTokens, true);
  const subject = template.subject != null ? renderText(template.subject, variables, unknownTokens, false) : null;
  return { subject, body, unknownTokens: [...unknownTokens] };
}

/** Publish-time check: which `{{...}}` tokens in this text aren't in KNOWN_TEMPLATE_VARIABLES, without needing a real lead to render against. */
export function findUnknownTemplateTokens(text: string): string[] {
  const unknownTokens = new Set<string>();
  const known = new Set<string>(KNOWN_TEMPLATE_VARIABLES);
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const key = match[1]!;
    if (!known.has(key)) unknownTokens.add(key);
  }
  return [...unknownTokens];
}
