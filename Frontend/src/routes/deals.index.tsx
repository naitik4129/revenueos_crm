import { createFileRoute } from "@tanstack/react-router";
import { DealsPage } from "@/features/deals/deals-page";

export const Route = createFileRoute("/deals/")({
  head: () => ({ meta: [{ title: "Deals - MOTM Flow" }] }),
  component: DealsPage,
});
