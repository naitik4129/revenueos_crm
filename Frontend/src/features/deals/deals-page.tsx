import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterSelect, Pager, SearchBox } from "@/components/common/list-controls";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { backend } from "@/lib/backend-client";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { messageFromError, useCrmMutation, useDeals, useSession } from "@/store";
import { DEAL_OUTCOMES, type Deal, type DealOutcome, type PipelineStage } from "@/types";
import { DEAL_DRAG_TYPE, groupDealsByStage } from "./board";
import { DealCard } from "./deal-card";
import { NewDealDialog } from "./new-deal-dialog";

const ALL = "all";
// The backend's page limit; the board shows open deals only (a few hundred per client).
const BOARD_LIMIT = 500;
const LIST_PAGE_SIZE = 50;

export function DealsPage() {
  const { users } = useSession();
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(ALL);
  const [newOpen, setNewOpen] = useState(false);
  const filters = { search: search || undefined, ownerId: owner === ALL ? undefined : owner };

  return (
    <div className="pb-10">
      <PageHeader
        title="Deals"
        description="Every deal in this workspace. Drag a card, or use its stage menu, to move it."
        actions={
          <>
            <div className="flex rounded-md border p-0.5" role="group" aria-label="View">
              {(["board", "list"] as const).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={view === v ? "secondary" : "ghost"}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className="h-7"
                >
                  {v === "board" ? "Board" : "List"}
                </Button>
              ))}
            </div>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              New deal
            </Button>
          </>
        }
      />
      {newOpen && <NewDealDialog onOpenChange={setNewOpen} />}

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox placeholder="Contact or company" label="Search deals" onSearch={setSearch} />
          <FilterSelect
            label="Owner"
            value={owner}
            onChange={setOwner}
            options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
          />
        </div>
        {view === "board" ? <Board {...filters} /> : <DealList {...filters} />}
      </div>
    </div>
  );
}

type Filters = { search: string | undefined; ownerId: string | undefined };

function Board(filters: Filters) {
  const { data, isLoading, error } = useDeals({ ...filters, outcome: "open", limit: BOARD_LIMIT });
  const [pending, setPending] = useState<Partial<Record<string, PipelineStage>>>({});
  const [dropTarget, setDropTarget] = useState<PipelineStage | null>(null);
  const update = useCrmMutation(({ id, stage }: { id: string; stage: PipelineStage }) =>
    backend.deals.update(id, { stage }),
  );

  if (isLoading) return <LoadingBlock label="Loading deals…" />;
  if (error) return <ErrorBlock error={error} />;
  const deals = data?.data ?? [];
  const columns = groupDealsByStage(deals, pending);

  const move = (deal: Deal, stage: PipelineStage) => {
    if ((pending[deal.id] ?? deal.stage) === stage) return;
    setPending((p) => ({ ...p, [deal.id]: stage }));
    update.mutate(
      { id: deal.id, stage },
      {
        onError: (err) => toast.error(`${deal.contactName}: ${messageFromError(err)}`),
        // On success the lists have been refetched; on failure the card goes back.
        onSettled: () => setPending(({ [deal.id]: _done, ...rest }) => rest),
      },
    );
  };

  return (
    <>
      {(data?.total ?? 0) > BOARD_LIMIT && (
        <p className="text-xs text-muted-foreground">
          Showing {BOARD_LIMIT} of {data?.total} open deals. Use search or the owner filter to
          narrow the board.
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[...columns].map(([stage, items]) => (
          <section
            key={stage}
            aria-label={`${label(stage)} column`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DEAL_DRAG_TYPE)) return;
              e.preventDefault();
              setDropTarget(stage);
            }}
            onDragLeave={() => setDropTarget((t) => (t === stage ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const deal = deals.find((d) => d.id === e.dataTransfer.getData(DEAL_DRAG_TYPE));
              if (deal) move(deal, stage);
            }}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-lg border bg-muted/40",
              dropTarget === stage && "border-primary bg-primary/5",
            )}
          >
            <header className="flex items-center justify-between px-3 py-2 text-xs font-medium">
              <span>{label(stage)}</span>
              <span className="num rounded-full bg-background px-2 py-0.5 text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 px-2 pb-2">
              {items.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  stage={stage}
                  pending={deal.id in pending}
                  onMove={(next) => move(deal, next)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function DealList(filters: Filters) {
  const [outcome, setOutcome] = useState(ALL);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [filters.search, filters.ownerId, outcome]);
  const { data, isLoading, error, isFetching } = useDeals({
    ...filters,
    outcome: outcome === ALL ? undefined : (outcome as DealOutcome),
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const deals = data?.data ?? [];

  return (
    <div className="space-y-3">
      <FilterSelect
        label="Outcome"
        value={outcome}
        onChange={setOutcome}
        options={[[ALL, "All outcomes"], ...DEAL_OUTCOMES.map((o) => [o, label(o)] as const)]}
      />
      {isLoading ? (
        <LoadingBlock label="Loading deals…" />
      ) : error ? (
        <ErrorBlock error={error} />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "Contact / Company",
                    "Outcome",
                    "Stage",
                    "Owner",
                    "Next action",
                    "Last activity",
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={isFetching ? "opacity-60" : undefined}>
                {deals.map((deal) => (
                  <tr key={deal.id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2">
                      <Link
                        to="/deals/$dealId"
                        params={{ dealId: deal.id }}
                        className="font-medium hover:underline"
                      >
                        {deal.contactName}
                      </Link>
                      {deal.companyName && (
                        <span className="block text-xs text-muted-foreground">
                          {deal.companyName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge value={deal.outcome} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge value={deal.stage} />
                    </td>
                    <td className="px-3 py-2 text-xs">{deal.ownerName ?? "Unassigned"}</td>
                    <td className="px-3 py-2 text-xs">
                      {deal.nextAction
                        ? `${deal.nextAction.title} · ${relDay(deal.nextAction.dueAt)}`
                        : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {relDay(deal.lastActivityAt)}
                    </td>
                  </tr>
                ))}
                {deals.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-sm text-muted-foreground"
                    >
                      No deals match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Pager
        offset={offset}
        pageSize={LIST_PAGE_SIZE}
        total={data?.total ?? 0}
        onOffset={setOffset}
      />
    </div>
  );
}
