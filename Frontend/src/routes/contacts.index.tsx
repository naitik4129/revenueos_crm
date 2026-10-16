import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/features/contacts/contacts-page";

export const Route = createFileRoute("/contacts/")({
  head: () => ({ meta: [{ title: "Contacts - MOTM Flow" }] }),
  component: ContactsPage,
});
