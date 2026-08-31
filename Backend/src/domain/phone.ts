import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizePhoneE164(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const parsed = parsePhoneNumberFromString(value, value.startsWith("+") ? undefined : "IN");
  if (!parsed?.isValid()) return null;
  return parsed.number;
}

export function phoneE164ToJid(phoneE164: string): string {
  return `${phoneE164.slice(1)}@s.whatsapp.net`;
}

export function jidToPhoneE164(jid: string): string | null {
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const local = jid.slice(0, jid.indexOf("@")).split(":", 1)[0];
  return local && /^[1-9][0-9]{7,14}$/.test(local) ? `+${local}` : null;
}
