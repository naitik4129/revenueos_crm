import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";

// shortcut: placeholder until P7c builds this screen.
export const Route = createFileRoute("/companies/")({
  head: () => ({ meta: [{ title: "Companies - MOTM Flow" }] }),
  component: () => <PageHeader title="Companies" description="Organisations in this workspace." />,
});
