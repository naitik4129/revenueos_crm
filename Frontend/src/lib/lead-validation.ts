import { parsePhoneNumberFromString } from "libphonenumber-js";
import { LEAD_SOURCES } from "@/types";

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

export interface LeadFormLike {
  firstName: string;
  company: string;
  email: string;
  phone: string;
  source: string;
}

export type LeadFormErrors = Partial<
  Record<"firstName" | "company" | "email" | "phone" | "source", string>
>;

/**
 * Single source of truth for lead field validation on the client, shared by
 * AddLeadDialog, EditLeadDialog, and the CSV import preview so the three
 * lead-entry paths can't silently diverge from each other.
 */
export function validateLeadForm(form: LeadFormLike): LeadFormErrors {
  const errors: LeadFormErrors = {};

  if (!form.firstName.trim()) errors.firstName = "First name is required.";
  if (!form.company.trim()) errors.company = "Company is required.";

  const email = form.email.trim();
  const phone = form.phone.trim();
  if (!email && !phone) {
    errors.email = "Provide at least an email or a phone number.";
  } else {
    if (email) {
      const { error } = normalizeEmail(email);
      if (error) errors.email = error;
    }
    if (phone) {
      const { error } = normalizePhone(phone);
      if (error) errors.phone = error;
    }
  }

  if (!form.source.trim() || !(LEAD_SOURCES as readonly string[]).includes(form.source)) {
    errors.source = "Select a lead source.";
  }

  return errors;
}
