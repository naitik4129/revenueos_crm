import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard - MOTM Flow" },
      {
        name: "description",
        content:
          "Daily sales cockpit: active leads, calls due today, meetings, proposal follow-ups and overdue actions.",
      },
      { property: "og:title", content: "Dashboard - MOTM Flow" },
      {
        property: "og:description",
        content: "Lead management and sales automation at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});
