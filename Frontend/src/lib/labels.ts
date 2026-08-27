const SPECIAL: Record<string, string> = {
  do_not_contact: "Do Not Contact",
  ready_for_first_call: "Ready for First Call",
  no_show: "No-show",
  whatsapp: "WhatsApp",
  call_outcome_maybe: "Call Outcome = Maybe",
  call_outcome_negative: "Call Outcome = Negative",
  call_not_connected: "Call Not Connected",
  proposal_pending: "Proposal Pending",
  manual_enrollment: "Manual Enrollment",
};
export function label(value?: string | null) {
  if (!value) return "—";
  return SPECIAL[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
