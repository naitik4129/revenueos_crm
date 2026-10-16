import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";

// shortcut: placeholder until P7d1 builds this screen.
export const Route = createFileRoute("/deals/")({
  head: () => ({ meta: [{ title: "Deals - MOTM Flow" }] }),
  component: () => <PageHeader title="Deals" description="Open deals by pipeline stage." />,
});
