import { createFileRoute } from "@tanstack/react-router";
import { MeetingsPage } from "@/features/meetings/meetings-page";

export const Route = createFileRoute("/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings — Northbeam CRM" },
      {
        name: "description",
        content:
          "Scheduled sales meetings with outcome capture that moves the lead to the next stage.",
      },
      { property: "og:title", content: "Meetings — Northbeam CRM" },
      { property: "og:description", content: "Book meetings and record what happened." },
    ],
  }),
  component: MeetingsPage,
});
