import { createFileRoute } from "@tanstack/react-router";
import { LeadsPage } from "@/features/leads/leads-page";

export const Route = createFileRoute("/leads/")({
  head: () => ({
    meta: [
      { title: "Leads - MOTM Flow" },
      {
        name: "description",
        content:
          "Every lead with its owner, pipeline stage, next action, due date and automation state.",
      },
      { property: "og:title", content: "Leads - MOTM Flow" },
      { property: "og:description", content: "Focused lead list with next-action tracking." },
    ],
  }),
  component: LeadsPage,
});
