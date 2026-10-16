import { createFileRoute } from "@tanstack/react-router";
import { CompanyDetailPage } from "@/features/companies/company-detail-page";

export const Route = createFileRoute("/companies/$companyId")({
  head: () => ({ meta: [{ title: "Company - MOTM Flow" }] }),
  component: CompanyDetailRoute,
});

function CompanyDetailRoute() {
  const { companyId } = Route.useParams();
  return <CompanyDetailPage key={companyId} companyId={companyId} />;
}
