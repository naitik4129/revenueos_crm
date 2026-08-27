import { createFileRoute } from "@tanstack/react-router";
import { WorkflowBuilderPage } from "@/features/automations/workflow-builder-page";

export const Route = createFileRoute("/automations/workflows/$workflowId")({
  head: () => ({
    meta: [
      { title: "Workflow builder — Northbeam CRM" },
      {
        name: "description",
        content:
          "Edit a nurture workflow as a numbered list of steps: delay, action and template. Publish to update n8n.",
      },
      { property: "og:title", content: "Workflow builder — Northbeam CRM" },
      {
        property: "og:description",
        content: "Managers change automation behaviour without touching n8n.",
      },
    ],
  }),
  component: WorkflowBuilderRoute,
});

function WorkflowBuilderRoute() {
  const { workflowId } = Route.useParams();
  return <WorkflowBuilderPage workflowId={workflowId} />;
}
