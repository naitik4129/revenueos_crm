import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard - MOTM Flow" },
      {
        name: "description",
        content: "Lifecycle funnel, open deals by stage, this week's activity and today's queue.",
      },
      { property: "og:title", content: "Dashboard - MOTM Flow" },
      {
        property: "og:description",
        content: "A client workspace at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});
