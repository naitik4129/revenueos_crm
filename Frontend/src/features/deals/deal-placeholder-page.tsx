import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { InfoRow } from "@/components/common/detail-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { relDay } from "@/lib/format";
import { useDeal } from "@/store";
import { CompanyLink } from "@/features/companies/company-link";

// shortcut: summary only until P7d2 builds the full deal page (actions, meetings, proposals, tasks).
export function DealPlaceholderPage({ dealId }: { dealId: string }) {
  const { data: deal, isLoading, error } = useDeal(dealId);
  if (isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading deal…" />
      </div>
    );
  if (!deal)
    return (
      <div className="p-6">
        <ErrorBlock error={error ?? new Error("Deal not found.")} />
      </div>
    );
  return (
    <div className="pb-10">
      <PageHeader
        title={deal.contactName}
        heading={
          <div>
            <Link to="/deals" className="text-xs text-muted-foreground hover:underline">
              Deals
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">Deal: {deal.contactName}</h1>
            <div className="mt-2 flex gap-1.5">
              <StatusBadge value={deal.outcome} />
              <StatusBadge value={deal.stage} />
            </div>
          </div>
        }
      />
      <div className="max-w-xl p-6">
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            <InfoRow
              name="Contact"
              value={
                <Link
                  to="/contacts/$contactId"
                  params={{ contactId: deal.contactId }}
                  className="hover:underline"
                >
                  {deal.contactName}
                </Link>
              }
            />
            <InfoRow
              name="Company"
              value={
                deal.companyName && <CompanyLink id={deal.companyId} name={deal.companyName} />
              }
            />
            <InfoRow name="Owner" value={deal.ownerName ?? "Unassigned"} />
            <InfoRow
              name="Next action"
              value={
                deal.nextAction && `${deal.nextAction.title} · ${relDay(deal.nextAction.dueAt)}`
              }
            />
            <InfoRow name="Last activity" value={relDay(deal.lastActivityAt)} />
            <p className="pt-2 text-xs text-muted-foreground">
              The full deal page comes in the next step.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
