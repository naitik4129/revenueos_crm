import { normalizeEmail } from "./email.js";
import { normalizePhoneE164 } from "./phone.js";

/**
 * Pure normalization/parsing for the public website contact form
 * (motsb2b.com/api/contact). No I/O. The form sends exactly five string keys;
 * industry / revenue range / diagnosis issue arrive packed into `message` as
 * `Label: value` lines (see parseMessage). Nothing in here throws on odd
 * input - a malformed field degrades to a safe default and the raw message is
 * always preserved, so a submission is never lost to a parsing surprise.
 */

export interface RawWebsiteForm {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
}

export interface NormalizedWebsiteForm {
  firstName: string;
  lastName: string;
  company: string;
  /** Valid, lowercased email, or null when missing/invalid. */
  email: string | null;
  /** Phone as the visitor typed it (cleaned), only when it is a valid number. */
  phone: string | null;
  phoneE164: string | null;
  /** Phone text that could not be validated, kept only for the timeline. */
  invalidPhone: string | null;
  industry: string | null;
  revenueRange: string | null;
  diagnosisIssue: string | null;
  /** Message with the recognised `Label:` lines removed. */
  challenge: string;
  /** Full cleaned message exactly as received (minus control chars). */
  message: string;
}

export const COMPANY_PLACEHOLDER = "Not provided";
export const UNKNOWN_FIRST_NAME = "Unknown";

const MAX_NAME = 200;
const MAX_COMPANY = 300;
const MAX_INDUSTRY = 120;
const MAX_FIELD = 200;
const MAX_EMAIL = 320;
const MAX_PHONE = 50;
const MAX_MESSAGE = 5000;

/** Single-line text: control chars to spaces, whitespace collapsed, trimmed, capped. */
function cleanLine(input: string | null | undefined, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Multi-line text: keeps newlines, normalizes CRLF, drops other control chars, trims each line's edges. */
function cleanMessage(input: string | null | undefined): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/(?!\n)\p{Cc}/gu, "")
    .split("\n")
    .map((line) => line.replace(/[  ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** Title-cases a name only when it is entirely lower or upper case, so "McDonald"/"de Souza" typed correctly are left alone. */
function fixNameCase(name: string): string {
  const hasLetters = /\p{L}/u.test(name);
  if (!hasLetters) return name;
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function splitName(rawName: string | null | undefined): { firstName: string; lastName: string } {
  const name = fixNameCase(cleanLine(rawName, MAX_NAME));
  if (!name) return { firstName: UNKNOWN_FIRST_NAME, lastName: "" };
  const space = name.indexOf(" ");
  if (space === -1) return { firstName: name, lastName: "" };
  return { firstName: name.slice(0, space), lastName: name.slice(space + 1).trim() };
}

/**
 * Strips separators and rewrites international-prefix variants into "+" form
 * before handing to the shared E.164 normalizer (which defaults bare national
 * numbers to India): `0091…` -> `+91…`, 12-digit `91…` -> `+91…`.
 */
function normalizePhoneInput(rawPhone: string): string | null {
  const stripped = rawPhone.replace(/[\s\-.()]/g, "");
  if (!stripped) return null;
  let candidate = stripped;
  if (candidate.startsWith("00")) candidate = `+${candidate.slice(2)}`;
  else if (/^91\d{10}$/.test(candidate)) candidate = `+${candidate}`;
  return normalizePhoneE164(candidate);
}

const LABEL_LINE = /^(industry|revenue range|diagnosis issue)\s*:\s*(.*)$/i;

export function parseMessage(rawMessage: string | null | undefined) {
  const message = cleanMessage(rawMessage);
  let industry: string | null = null;
  let revenueRange: string | null = null;
  let diagnosisIssue: string | null = null;
  const challengeLines: string[] = [];

  for (const line of message.split("\n")) {
    const match = LABEL_LINE.exec(line);
    if (!match) {
      challengeLines.push(line);
      continue;
    }
    const label = match[1]!.toLowerCase();
    const value = cleanLine(match[2], label === "industry" ? MAX_INDUSTRY : MAX_FIELD) || null;
    if (label === "industry") industry ??= value;
    else if (label === "revenue range") revenueRange ??= value;
    else diagnosisIssue ??= value;
  }

  return {
    message,
    industry,
    revenueRange,
    diagnosisIssue,
    challenge: challengeLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function normalizeWebsiteForm(raw: RawWebsiteForm): NormalizedWebsiteForm {
  const { firstName, lastName } = splitName(raw.name);
  const company = cleanLine(raw.company, MAX_COMPANY) || COMPANY_PLACEHOLDER;
  const email = normalizeEmail(cleanLine(raw.email, MAX_EMAIL));

  const phoneText = cleanLine(raw.phone, MAX_PHONE);
  const phoneE164 = phoneText ? normalizePhoneInput(phoneText) : null;

  const parsed = parseMessage(raw.message);

  return {
    firstName,
    lastName,
    company,
    email,
    phone: phoneE164 ? phoneText : null,
    phoneE164,
    invalidPhone: phoneText && !phoneE164 ? phoneText : null,
    industry: parsed.industry,
    revenueRange: parsed.revenueRange,
    diagnosisIssue: parsed.diagnosisIssue,
    challenge: parsed.challenge,
    message: parsed.message,
  };
}

/**
 * Human-readable timeline body for a submission. Deterministic for a given
 * normalized form, which is what lets the ingest service recognise an
 * identical resubmission (double click / retry) by comparing this text.
 */
export function formatSubmissionDetail(form: NormalizedWebsiteForm): string {
  const lines: string[] = [];
  if (form.challenge) lines.push(`Message: ${form.challenge}`);
  if (form.industry) lines.push(`Industry: ${form.industry}`);
  if (form.revenueRange) lines.push(`Revenue range: ${form.revenueRange}`);
  if (form.diagnosisIssue) lines.push(`Diagnosis issue: ${form.diagnosisIssue}`);
  if (form.invalidPhone) lines.push(`Phone as entered (not a valid number, not saved on the lead): ${form.invalidPhone}`);
  return lines.length > 0 ? lines.join("\n") : "No message provided.";
}
