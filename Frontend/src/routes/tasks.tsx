import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/features/tasks/tasks-page";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Northbeam CRM" },
      {
        name: "description",
        content: "Every call, follow-up and reminder due for the sales team, grouped by urgency.",
      },
      { property: "og:title", content: "Tasks — Northbeam CRM" },
      {
        property: "og:description",
        content: "Today, overdue and upcoming sales tasks in one queue.",
      },
    ],
  }),
  component: TasksPage,
});
