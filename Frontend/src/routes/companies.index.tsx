import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/features/companies/companies-page";

export const Route = createFileRoute("/companies/")({
  head: () => ({ meta: [{ title: "Companies - MOTM Flow" }] }),
  component: CompaniesPage,
});
