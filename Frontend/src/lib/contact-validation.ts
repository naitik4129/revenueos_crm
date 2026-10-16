import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Mirrors Backend/src/domain/phone.ts exactly (same library, same region
 * default) so the UI's verdict never drifts from what the server accepts.
 */
export function normalizePhone(raw: string): { value: string | null; error: string | null } {
  const value = raw.trim();
  if (!value) return { value: null, error: null };

  const parsed = parsePhoneNumberFromString(value, value.startsWith("+") ? undefined : "IN");
  if (!parsed?.isValid()) {
    return {
      value: null,
      error:
        "Enter a valid phone number. Indian local numbers default to +91; international numbers must include their country code.",
    };
  }
  return { value: parsed.number, error: null };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Non-authoritative client-side check — same philosophy as the CSV import
 * preview validator. The backend (Backend/src/domain/email.ts) is the real
 * authority and re-validates every value it receives.
 */
export function normalizeEmail(raw: string): { value: string | null; error: string | null } {
  const value = raw.trim().toLowerCase();
  if (!value) return { value: null, error: null };
  if (!EMAIL_RE.test(value)) return { value: null, error: "Enter a valid email address." };
  return { value, error: null };
}

export type ContactFormErrors = Partial<Record<"firstName" | "email" | "phone", string>>;

/**
 * Client-side mirror of the backend's validateContactFields (the backend re-checks): first
 * name required, plus at least an email, a phone number or a LinkedIn URL.
 */
export function validateContact(form: {
  firstName: string;
  email?: string | undefined;
  phone?: string | undefined;
  linkedinUrl?: string | undefined;
}): ContactFormErrors {
  const errors: ContactFormErrors = {};
  if (!form.firstName.trim()) errors.firstName = "First name is required.";
  const email = form.email?.trim() ?? "";
  const phone = form.phone?.trim() ?? "";
  if (!email && !phone && !form.linkedinUrl?.trim()) {
    errors.email = "Provide at least an email, a phone number or a LinkedIn URL.";
  }
  if (email && normalizeEmail(email).error) errors.email = normalizeEmail(email).error!;
  if (phone && normalizePhone(phone).error) errors.phone = normalizePhone(phone).error!;
  return errors;
}
