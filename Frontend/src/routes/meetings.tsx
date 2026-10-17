import { createFileRoute } from "@tanstack/react-router";
import { viewSearch } from "@/lib/view-search";
import { MeetingsPage } from "@/features/meetings/meetings-page";

export const Route = createFileRoute("/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings - MOTM Flow" },
      {
        name: "description",
        content:
          "Scheduled sales meetings with outcome capture that moves the lead to the next stage.",
      },
      { property: "og:title", content: "Meetings - MOTM Flow" },
      { property: "og:description", content: "Book meetings and record what happened." },
    ],
  }),
  validateSearch: viewSearch,
  component: function MeetingsRoute() {
    return <MeetingsPage initialView={Route.useSearch().view} />;
  },
});
