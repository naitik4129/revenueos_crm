import type { Template } from "@/types";

export const templates: Template[] = [
  {
    id: "tp1",
    name: "Company Introduction",
    type: "Email",
    subject: "A quick introduction to Northbeam",
    body: "Hi {{first_name}},\n\nI tried reaching you earlier today. We help {{industry}} teams automate their sales follow-up so nothing slips.\n\nWorth a short call this week?\n\n— {{owner_name}}",
    active: true,
  },
  {
    id: "tp2",
    name: "Relevant Case Study",
    type: "Email",
    subject: "How a team like yours cut follow-up time by 60%",
    body: "Hi {{first_name}},\n\nSharing a short case study that mirrors what you are working on.\n\nHappy to walk you through it.",
    attachment: "northbeam-case-study.pdf",
    active: true,
  },
  {
    id: "tp3",
    name: "Success Story",
    type: "Email",
    subject: "A recent result you might like",
    body: "Hi {{first_name}},\n\nOne of our customers doubled their meeting rate in a quarter. Here is what changed.",
    active: true,
  },
  {
    id: "tp4",
    name: "Service Overview",
    type: "Email",
    subject: "What we do, in one page",
    body: "Hi {{first_name}},\n\nAttaching a one-pager covering our services and typical engagement model.",
    attachment: "northbeam-services.pdf",
    active: true,
  },
  {
    id: "tp5",
    name: "Meeting CTA",
    type: "Email",
    subject: "15 minutes this week?",
    body: "Hi {{first_name}},\n\nWould a 15 minute call on Thursday work? Here is my calendar link.",
    active: true,
  },
  {
    id: "tp6",
    name: "Proposal Follow-up",
    type: "WhatsApp",
    subject: "Proposal follow-up",
    body: "Hi {{first_name}}, following up on the proposal we shared. Any questions before you decide?",
    active: true,
  },
];
