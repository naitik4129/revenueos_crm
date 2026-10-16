import { Link } from "@tanstack/react-router";
import { useDealIndex } from "@/store";

/** "Contact · Company" linking to the deal page, for lists that only know the deal id. */
export function DealLink({ dealId }: { dealId?: string | undefined }) {
  const deals = useDealIndex();
  if (!dealId) return null;
  const deal = deals.get(dealId);
  return (
    <Link to="/deals/$dealId" params={{ dealId }} className="hover:underline">
      {deal ? [deal.contactName, deal.companyName].filter(Boolean).join(" · ") : "Deal"}
    </Link>
  );
}
