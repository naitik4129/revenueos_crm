import { createFileRoute } from "@tanstack/react-router";
import { ContactDetailPage } from "@/features/contacts/contact-detail-page";

export const Route = createFileRoute("/contacts/$contactId")({
  head: () => ({ meta: [{ title: "Contact - MOTM Flow" }] }),
  component: ContactDetailRoute,
});

function ContactDetailRoute() {
  const { contactId } = Route.useParams();
  return <ContactDetailPage key={contactId} contactId={contactId} />;
}
