/**
 * Mirrors Backend/src/domain/templateRenderer.ts's KNOWN_TEMPLATE_VARIABLES.
 * The frontend can't import backend TS directly, so this list is kept in
 * sync by hand — update both together.
 */
export const TEMPLATE_VARIABLES = [
  { token: "lead.firstName", label: "Lead first name" },
  { token: "lead.lastName", label: "Lead last name" },
  { token: "lead.fullName", label: "Lead full name" },
  { token: "lead.company", label: "Lead company" },
  { token: "lead.email", label: "Lead email" },
  { token: "lead.phone", label: "Lead phone" },
  { token: "owner.name", label: "Owner name" },
  { token: "current.date", label: "Current date" },
  { token: "tomorrow.date", label: "Tomorrow's date" },
  { token: "current.time", label: "Current time" },
  { token: "meeting.date", label: "Meeting date" },
  { token: "meeting.time", label: "Meeting time" },
  { token: "meeting.title", label: "Meeting title" },
  { token: "meeting.duration", label: "Meeting duration" },
  { token: "meeting.link", label: "Meeting link" },
] as const;
