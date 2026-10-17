import { createFileRoute } from "@tanstack/react-router";
import { viewSearch } from "@/lib/view-search";
import { DealsPage } from "@/features/deals/deals-page";

export const Route = createFileRoute("/deals/")({
  head: () => ({ meta: [{ title: "Deals - MOTM Flow" }] }),
  validateSearch: viewSearch,
  component: function DealsRoute() {
    return <DealsPage initialView={Route.useSearch().view} />;
  },
});
