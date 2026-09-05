import { createFileRoute } from "@tanstack/react-router";
import { WorkflowBuilderPage } from "@/features/automations/workflow-builder-page";

export const Route = createFileRoute("/automations/workflows/$workflowId")({
  head: () => ({
    meta: [
      { title: "Workflow builder — MOTM Flow" },
      {
        name: "description",
        content:
          "Edit a nurture workflow as a numbered list of steps: delay, action and template. Publish to update live behaviour.",
      },
      { property: "og:title", content: "Workflow builder — MOTM Flow" },
      {
        property: "og:description",
        content: "Managers change automation behaviour without touching code.",
      },
    ],
  }),
  component: WorkflowBuilderRoute,
});

function WorkflowBuilderRoute() {
  const { workflowId } = Route.useParams();
  return <WorkflowBuilderPage workflowId={workflowId} />;
}
