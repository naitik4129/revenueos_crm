import { createFileRoute } from "@tanstack/react-router";
import { WorkflowsPage } from "@/features/automations/workflows-page";

export const Route = createFileRoute("/automations/")({
  head: () => ({
    meta: [
      { title: "Automations — Northbeam CRM" },
      {
        name: "description",
        content:
          "Nurture workflows managers can edit without a developer: triggers, sequential steps and message templates.",
      },
      { property: "og:title", content: "Automations — Northbeam CRM" },
      {
        property: "og:description",
        content: "Edit nurture behaviour in the CRM; n8n executes what you publish.",
      },
    ],
  }),
  component: WorkflowsPage,
});
