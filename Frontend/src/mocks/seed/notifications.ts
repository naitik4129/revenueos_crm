import type { AppNotification } from "@/types";

import { at } from "./clock";

export const notifications: AppNotification[] = [
  {
    id: "nt1",
    title: "Automation failure",
    detail: "Trailhead Travel — email step failed in Not Connected Nurture",
    at: at(0, "08:10"),
    kind: "danger",
    href: "/automations/runs",
    read: false,
  },
  {
    id: "nt2",
    title: "Proposal follow-up due",
    detail: "FinFlow Technologies — follow-up scheduled for today",
    at: at(0, "07:30"),
    kind: "warning",
    leadId: "l2",
    read: false,
  },
  {
    id: "nt3",
    title: "Overdue call",
    detail: "Skyline Logistics — first call was due yesterday",
    at: at(-1, "16:05"),
    kind: "warning",
    leadId: "l6",
    read: false,
  },
  {
    id: "nt4",
    title: "Meeting tomorrow",
    detail: "Corewave Systems — discovery call at 3:00 PM",
    at: at(-1, "11:10"),
    kind: "info",
    href: "/meetings",
    read: true,
  },
  {
    id: "nt5",
    title: "Workflow published",
    detail: "Not Connected Nurture V3 is live for new leads",
    at: at(-5, "11:00"),
    kind: "success",
    href: "/automations",
    read: true,
  },
];
