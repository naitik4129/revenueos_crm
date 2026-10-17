import { createFileRoute } from "@tanstack/react-router";
import { viewSearch } from "@/lib/view-search";
import { ProposalsPage } from "@/features/proposals/proposals-page";

export const Route = createFileRoute("/proposals/")({
  head: () => ({
    meta: [
      { title: "Proposals - MOTM Flow" },
      {
        name: "description",
        content: "Upload proposals, track what was sent and record the accept or reject decision.",
      },
      { property: "og:title", content: "Proposals - MOTM Flow" },
      { property: "og:description", content: "Simple proposal tracking with follow-up dates." },
    ],
  }),
  validateSearch: viewSearch,
  component: function ProposalsRoute() {
    return <ProposalsPage initialView={Route.useSearch().view} />;
  },
});
