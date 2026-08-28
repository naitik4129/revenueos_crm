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

export interface RenderableTemplate {
  subject: string | null;
  body: string;
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  unknownTokens: string[];
}

function buildVariableMap(lead: TemplateRenderLead): Map<string, string> {
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
  ]);
}

/** The full set of `{{...}}` tokens this renderer understands — the source of truth for UI variable pickers and publish-time validation. */
export const KNOWN_TEMPLATE_VARIABLES = [
  "lead.firstName",
  "lead.lastName",
  "lead.fullName",
  "lead.company",
  "lead.email",
  "lead.phone",
  "owner.name",
] as const;

const TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

function renderText(text: string, variables: Map<string, string>, unknownTokens: Set<string>): string {
  return text.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = variables.get(key);
    if (value !== undefined) return value;
    unknownTokens.add(key);
    return match;
  });
}

export function renderTemplate(template: RenderableTemplate, lead: TemplateRenderLead): RenderedTemplate {
  const variables = buildVariableMap(lead);
  const unknownTokens = new Set<string>();
  const body = renderText(template.body, variables, unknownTokens);
  const subject = template.subject != null ? renderText(template.subject, variables, unknownTokens) : null;
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
