import { createFileRoute } from "@tanstack/react-router";
import { RunsPage } from "@/features/automations/runs-page";

export const Route = createFileRoute("/automations/runs")({
  head: () => ({
    meta: [
      { title: "Automation runs - MOTM Flow" },
      {
        name: "description",
        content:
          "Every workflow run per lead: current step, next scheduled action, failures and retries.",
      },
      { property: "og:title", content: "Automation runs - MOTM Flow" },
      {
        property: "og:description",
        content: "Monitor what the automation worker is doing for each lead.",
      },
    ],
  }),
  component: RunsPage,
});
