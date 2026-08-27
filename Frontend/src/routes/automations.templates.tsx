import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "@/features/automations/templates-page";

export const Route = createFileRoute("/automations/templates")({
  head: () => ({
    meta: [
      { title: "Message templates — Northbeam CRM" },
      {
        name: "description",
        content: "Email and WhatsApp message templates used by nurture workflow steps.",
      },
      { property: "og:title", content: "Message templates — Northbeam CRM" },
      {
        property: "og:description",
        content: "A simple library of message bodies managers can edit.",
      },
    ],
  }),
  component: TemplatesPage,
});
