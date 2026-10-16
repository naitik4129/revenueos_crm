const SPECIAL: Record<string, string> = {
  do_not_contact: "Do Not Contact",
  ready_for_first_call: "Ready for First Call",
  no_show: "No-show",
  whatsapp: "WhatsApp",
  call_not_connected: "Call Not Connected",
  proposal_pending: "Proposal Pending",
  manual_enrollment: "Manual Enrollment",
  deal_created: "New Deal Created",
  meeting_scheduled: "Meeting Scheduled",
  meeting_agreed: "Meeting Agreed",
  // Pipeline stages
  connected_qualifying: "Connected - Qualifying",
  interested_later: "Interested - Later",
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
  objection_internal_approval:
    "Objection: Internal Approval (also used for Meeting: Needs Internal Discussion)",
  meeting_needs_more_information: "Meeting: Needs More Information",
  meeting_not_ready: "Meeting: Not Ready (Timed Nurture)",
  meeting_highly_interested: "Meeting: Highly Interested",
  meeting_proposal_requested: "Meeting: Proposal Requested",
  meeting_not_a_fit: "Meeting: Not a Fit (Archive / Alternate Service)",
};
export function label(value?: string | null) {
  if (!value) return "-";
  return SPECIAL[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const WORKFLOW_TRIGGER_SPECIAL: Record<string, string> = {
  meeting_agreed: "Call Outcome = Meeting Agreed",
};

export function workflowTriggerLabel(value?: string | null) {
  if (!value) return label(value);
  return WORKFLOW_TRIGGER_SPECIAL[value] ?? label(value);
}
