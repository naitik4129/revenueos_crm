const SPECIAL: Record<string, string> = {
  do_not_contact: "Do Not Contact",
  ready_for_first_call: "Ready for First Call",
  no_show: "No-show",
  whatsapp: "WhatsApp",
  call_not_connected: "Call Not Connected",
  proposal_pending: "Proposal Pending",
  manual_enrollment: "Manual Enrollment",
  lead_created: "New Lead Created",
  // Pipeline stages
  connected_qualifying: "Connected – Qualifying",
  interested_later: "Interested – Later",
  future_possibility: "Future Possibility",
  objection_nurture: "Objection Nurture",
  negotiation: "Negotiation",
  // Call dispositions
  commission_only: "Commission Only",
  internal_hiring: "Internal Hiring",
  existing_team: "Existing Team",
  budget_price: "Budget / Price",
  internal_approval: "Internal Approval",
  wrong_fit: "Wrong Fit",
  wrong_person: "Wrong Person",
  information_requested: "Send Information",
  // Meeting outcomes
  highly_interested: "Highly Interested",
  needs_internal_discussion: "Needs Internal Discussion",
  needs_more_information: "Needs More Information",
  no_proposal_required: "No Proposal Required",
  // Loss reasons
  price_budget: "Price / Budget",
  project_postponed: "Project Postponed",
  competitor_selected: "Competitor Selected",
  management_rejected: "Management Rejected",
  no_urgency: "No Urgency",
  no_response: "No Response",
  // Workflow triggers introduced in this phase
  call_outcome_interested_later: "Call Outcome = Interested Later",
  call_outcome_future_possibility: "Call Outcome = Future Possibility",
  call_outcome_information_requested: "Call Outcome = Information Requested",
  objection_commission_only: "Objection: Commission Only",
  objection_internal_hiring: "Objection: Internal Hiring",
  objection_existing_team: "Objection: Existing Team",
  objection_budget_price: "Objection: Budget / Price",
  objection_internal_approval: "Objection: Internal Approval",
  meeting_needs_more_information: "Meeting: Needs More Information",
  meeting_not_ready: "Meeting: Not Ready",
};
export function label(value?: string | null) {
  if (!value) return "—";
  return SPECIAL[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
