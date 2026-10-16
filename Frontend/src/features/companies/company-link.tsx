import { Link } from "@tanstack/react-router";

/** A company name that opens the company page (plain text when there is no company id). */
export function CompanyLink({ id, name }: { id?: string | undefined; name?: string | undefined }) {
  if (!id || !name) return <>{name ?? null}</>;
  return (
    <Link to="/companies/$companyId" params={{ companyId: id }} className="hover:underline">
      {name}
    </Link>
  );
}
