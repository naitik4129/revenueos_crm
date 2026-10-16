import { createFileRoute } from "@tanstack/react-router";
import { DealPlaceholderPage } from "@/features/deals/deal-placeholder-page";

export const Route = createFileRoute("/deals/$dealId")({
  head: () => ({ meta: [{ title: "Deal - MOTM Flow" }] }),
  component: DealRoute,
});

function DealRoute() {
  const { dealId } = Route.useParams();
  return <DealPlaceholderPage key={dealId} dealId={dealId} />;
}
