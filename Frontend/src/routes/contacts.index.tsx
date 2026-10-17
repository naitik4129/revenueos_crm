import { createFileRoute } from "@tanstack/react-router";
import { viewSearch } from "@/lib/view-search";
import { ContactsPage } from "@/features/contacts/contacts-page";

export const Route = createFileRoute("/contacts/")({
  head: () => ({ meta: [{ title: "Contacts - MOTM Flow" }] }),
  validateSearch: viewSearch,
  component: function ContactsRoute() {
    return <ContactsPage initialView={Route.useSearch().view} />;
  },
});
