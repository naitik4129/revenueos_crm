import { normalizeEmail, normalizePhone } from "./lead-validation";

export { normalizeEmail, normalizePhone };

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
