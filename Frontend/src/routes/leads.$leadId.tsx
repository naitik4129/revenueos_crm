import { createFileRoute } from "@tanstack/react-router";
import { LeadDetailPage } from "@/features/leads/lead-detail-page";

export const Route = createFileRoute("/leads/$leadId")({
  head: () => ({
    meta: [
      { title: "Lead detail — Northbeam CRM" },
      {
        name: "description",
        content:
          "Full lead record: next action, activity history, meetings, proposals and automation state.",
      },
      { property: "og:title", content: "Lead detail — Northbeam CRM" },
      {
        property: "og:description",
        content: "One screen for everything that happened with a lead.",
      },
    ],
  }),
  component: LeadDetailRoute,
});

function LeadDetailRoute() {
  const { leadId } = Route.useParams();
  return <LeadDetailPage leadId={leadId} />;
}
