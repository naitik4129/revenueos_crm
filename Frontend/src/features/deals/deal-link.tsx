import { Link } from "@tanstack/react-router";

/**
 * "Contact · Company" for list rows: links to the deal, or to the contact for a contact-only
 * task. The names come with the row from the list endpoints.
 */
export function DealLink({
  dealId,
  contactId,
  contactName,
  companyName,
}: {
  dealId?: string | undefined;
  contactId?: string | undefined;
  contactName?: string | undefined;
  companyName?: string | undefined;
}) {
  const text = [contactName, companyName].filter(Boolean).join(" · ");
  if (dealId) {
    return (
      <Link to="/deals/$dealId" params={{ dealId }} className="hover:underline">
        {text || "Deal"}
      </Link>
    );
  }
  if (!contactId) return null;
  return (
    <Link to="/contacts/$contactId" params={{ contactId }} className="hover:underline">
      {text || "Contact"}
    </Link>
  );
}
