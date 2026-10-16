import { createFileRoute } from "@tanstack/react-router";
import { DealDetailPage } from "@/features/deals/deal-detail-page";

export const Route = createFileRoute("/deals/$dealId")({
  head: () => ({ meta: [{ title: "Deal - MOTM Flow" }] }),
  component: DealRoute,
});

function DealRoute() {
  const { dealId } = Route.useParams();
  return <DealDetailPage key={dealId} dealId={dealId} />;
}
