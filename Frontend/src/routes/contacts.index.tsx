import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";

// shortcut: placeholder until P7b builds this screen.
export const Route = createFileRoute("/contacts/")({
  head: () => ({ meta: [{ title: "Contacts - MOTM Flow" }] }),
  component: () => (
    <PageHeader
      title="Contacts"
      description="People in this workspace, from the brain and your team."
    />
  ),
});
