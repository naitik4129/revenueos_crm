import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  RelTime,
  BulkBar,
  ColumnChooser,
  FilterSelect,
  ListEmptyState,
  Pager,
  RecordTable,
  SearchBox,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
import { Avatar } from "@/components/common/record-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { backend, type DealFilters } from "@/lib/backend-client";
import { downloadCsv } from "@/lib/csv";
import { fmtDate, isOverdue } from "@/lib/format";
import { label } from "@/lib/labels";
import { useBulkAssignOwner } from "@/lib/use-bulk-assign";
import { useStoredColumns } from "@/lib/use-stored-columns";
import { cn } from "@/lib/utils";
import { messageFromError, useCrmMutation, useDeals, useSession } from "@/store";
import { DEAL_OUTCOMES, type Deal, type DealOutcome, type PipelineStage } from "@/types";
import { DEAL_DRAG_TYPE, groupDealsByStage } from "./board";
import { DealCard } from "./deal-card";
import { NewDealDialog } from "./new-deal-dialog";
import { countLabel } from "@/lib/format";

const ALL = "all";
// The backend's page limit; the board shows open deals only (a few hundred per client).
const BOARD_LIMIT = 500;
const LIST_PAGE_SIZE = 50;

type Filters = { owner: string; noNextAction: boolean };
const NO_FILTERS: Filters = { owner: ALL, noNextAction: false };

// Fixed views are filter presets; the tab is highlighted while the filters still match it.
const VIEWS: { id: string; label: string; filters: (me?: string) => Filters }[] = [
  { id: "all", label: "All deals", filters: () => NO_FILTERS },
  { id: "mine", label: "My deals", filters: (me) => ({ ...NO_FILTERS, owner: me ?? ALL }) },
  {
    id: "noNext",
    label: "No next action",
    filters: () => ({ ...NO_FILTERS, noNextAction: true }),
  },
];

export function DealsPage({ initialView }: { initialView?: string | undefined } = {}) {
  const { users, currentUser } = useSession();
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(
    () => VIEWS.find((v) => v.id === initialView)?.filters(currentUser?.id) ?? NO_FILTERS,
  );
  const [newOpen, setNewOpen] = useState(false);
  // The board and the list each load their own page; they report its total for the header.
  const [total, setTotal] = useState<number>();
  const query: DealFilters = {
    search: search || undefined,
    ownerId: filters.owner === ALL ? undefined : filters.owner,
    missingNextAction: filters.noNextAction || undefined,
  };

  const views = VIEWS.filter((v) => v.id !== "mine" || currentUser);
  const activeView =
    views.find((v) => JSON.stringify(v.filters(currentUser?.id)) === JSON.stringify(filters))?.id ??
    null;

  // Search and owner live here so they survive a board/list switch.
  const sharedFilters = (
    <>
      <SearchBox
        placeholder="Search contact or company"
        label="Search deals"
        onSearch={setSearch}
        initial={search}
      />
      <FilterSelect
        label="Owner"
        value={filters.owner}
        onChange={(owner) => setFilters((f) => ({ ...f, owner }))}
        options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
      />
    </>
  );

  return (
    <div className="pb-10">
      <PageHeader
        title="Deals"
        count={
          total === undefined
            ? undefined
            : countLabel(total, view === "board" ? "open deal" : "deal")
        }
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
              Create deal
            </Button>
          </>
        }
        tabs={
          <ViewTabs
            views={views}
            active={activeView}
            onSelect={(id) =>
              setFilters(views.find((v) => v.id === id)?.filters(currentUser?.id) ?? NO_FILTERS)
            }
          />
        }
      />
      {newOpen && <NewDealDialog onOpenChange={setNewOpen} />}

      <div className="px-6 py-4">
        {view === "board" ? (
          <Board query={query} toolbar={sharedFilters} onTotal={setTotal} />
        ) : (
          <DealList query={query} toolbar={sharedFilters} onTotal={setTotal} />
        )}
      </div>
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">{children}</div>
  );
}

function Board({
  query,
  toolbar,
  onTotal,
}: {
  query: DealFilters;
  toolbar: ReactNode;
  onTotal: (total: number | undefined) => void;
}) {
  const { data, isLoading, error } = useDeals({ ...query, outcome: "open", limit: BOARD_LIMIT });
  useEffect(() => onTotal(data?.total), [data?.total, onTotal]);
  const [pending, setPending] = useState<Partial<Record<string, PipelineStage>>>({});
  const [dropTarget, setDropTarget] = useState<PipelineStage | null>(null);
  const update = useCrmMutation(({ id, stage }: { id: string; stage: PipelineStage }) =>
    backend.deals.update(id, { stage }),
  );

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
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <Toolbar>
          {toolbar}
          <span className="ml-auto text-xs text-muted-foreground">
            {data && data.total > BOARD_LIMIT
              ? `Showing ${BOARD_LIMIT} of ${data.total}; narrow with search.`
              : "Drag a card, or use its stage menu, to move it."}
          </span>
        </Toolbar>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading deals…" />
      ) : error ? (
        <ErrorBlock error={error} />
      ) : (
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
                "flex w-60 shrink-0 flex-col rounded-lg border bg-muted/40",
                dropTarget === stage && "border-primary bg-primary/5",
              )}
            >
              <header className="flex items-center justify-between border-b px-3 py-2 text-xs font-semibold">
                <span className="truncate">{label(stage)}</span>
                <span className="num rounded-full bg-background px-2 py-0.5 font-normal text-muted-foreground">
                  {items.length}
                </span>
              </header>
              <div className="flex min-h-24 flex-col gap-2 p-2">
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
      )}
    </div>
  );
}

const COLUMNS: ListColumn<Deal>[] = [
  {
    id: "company",
    label: "Company",
    cell: (d) =>
      d.companyId && (
        <Link
          to="/companies/$companyId"
          params={{ companyId: d.companyId }}
          className="hover:underline"
        >
          {d.companyName}
        </Link>
      ),
  },
  { id: "stage", label: "Stage", cell: (d) => <StatusBadge value={d.stage} /> },
  { id: "outcome", label: "Outcome", cell: (d) => <StatusBadge value={d.outcome} /> },
  {
    id: "owner",
    label: "Owner",
    cell: (d) => d.ownerName ?? <span className="text-muted-foreground">Unassigned</span>,
  },
  {
    id: "nextAction",
    label: "Next action",
    cell: (d) =>
      d.nextAction && (
        <span className={isOverdue(d.nextAction.dueAt) ? "text-destructive" : undefined}>
          {d.nextAction.title} · <RelTime iso={d.nextAction.dueAt} />
        </span>
      ),
  },
  { id: "lastActivity", label: "Last activity", cell: (d) => <RelTime iso={d.lastActivityAt} /> },
  { id: "service", label: "Service interest", cell: (d) => d.serviceInterest },
  { id: "automation", label: "Automation", cell: (d) => label(d.automationMode) },
  {
    id: "lifecycle",
    label: "Lifecycle",
    cell: (d) => <StatusBadge value={d.lifecycleStage} tone="neutral" />,
  },
  { id: "created", label: "Created", cell: (d) => fmtDate(d.createdAt) },
  { id: "closed", label: "Closed", cell: (d) => d.closedAt && fmtDate(d.closedAt) },
];
const DEFAULT_COLUMNS = ["company", "stage", "outcome", "owner", "nextAction", "lastActivity"];

function DealList({
  query,
  toolbar,
  onTotal,
}: {
  query: DealFilters;
  toolbar: ReactNode;
  onTotal: (total: number | undefined) => void;
}) {
  const { users } = useSession();
  const [outcome, setOutcome] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [visible, setVisible] = useStoredColumns("deals.columns", DEFAULT_COLUMNS);
  const assignOwner = useBulkAssignOwner(
    (id, ownerId) => backend.deals.update(id, { ownerId }),
    "deal",
  );
  const key = JSON.stringify({ ...query, outcome });
  // Any filter change starts again at the first page; selection is per page.
  useEffect(() => setOffset(0), [key]);
  useEffect(() => setSelected([]), [key, offset]);

  const { data, isLoading, error, isFetching } = useDeals({
    ...query,
    outcome: outcome === ALL ? undefined : (outcome as DealOutcome),
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const deals = data?.data ?? [];
  const total = data?.total ?? 0;
  useEffect(() => onTotal(data?.total), [data?.total, onTotal]);

  const exportSelected = () =>
    downloadCsv("deals.csv", [
      [
        "Contact",
        "Company",
        "Service interest",
        "Stage",
        "Outcome",
        "Owner",
        "Next action",
        "Next action due",
        "Automation",
        "Last activity",
        "Created",
        "Closed",
      ],
      ...deals
        .filter((d) => selected.includes(d.id))
        .map((d) => [
          d.contactName,
          d.companyName ?? "",
          d.serviceInterest ?? "",
          label(d.stage),
          label(d.outcome),
          d.ownerName ?? "",
          d.nextAction?.title ?? "",
          d.nextAction?.dueAt ?? "",
          label(d.automationMode),
          d.lastActivityAt,
          d.createdAt,
          d.closedAt ?? "",
        ]),
    ]);

  return (
    <Card className="overflow-hidden p-0">
      <Toolbar>
        {selected.length > 0 ? (
          <BulkBar
            count={selected.length}
            users={users}
            assigning={assignOwner.isPending}
            onAssign={(ownerId) => assignOwner.assign(selected, ownerId, () => setSelected([]))}
            onExport={exportSelected}
            onClear={() => setSelected([])}
          />
        ) : (
          <>
            {toolbar}
            <FilterSelect
              label="Outcome"
              value={outcome}
              onChange={setOutcome}
              options={[[ALL, "All outcomes"], ...DEAL_OUTCOMES.map((o) => [o, label(o)] as const)]}
            />
            <div className="ml-auto">
              <ColumnChooser columns={COLUMNS} visible={visible} onChange={setVisible} />
            </div>
          </>
        )}
      </Toolbar>

      {isLoading ? (
        <LoadingBlock label="Loading deals…" />
      ) : error ? (
        <ErrorBlock error={error} />
      ) : deals.length === 0 ? (
        <ListEmptyState
          icon={Handshake}
          title="No deals match these filters."
          text="A deal opens on a qualified handover, a call that moves the pipeline, or with Create deal."
        />
      ) : (
        <RecordTable
          rows={deals}
          columns={COLUMNS.filter((c) => visible.includes(c.id))}
          rowLabel={(d) => d.contactName}
          selected={selected}
          onSelect={setSelected}
          dimmed={isFetching}
          name={(d) => (
            <div className="flex items-center gap-2.5">
              <Avatar name={d.contactName} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link
                    to="/deals/$dealId"
                    params={{ dealId: d.id }}
                    className="truncate font-medium hover:underline"
                  >
                    {d.contactName}
                  </Link>
                  {d.doNotContact && <StatusBadge value="DNC" tone="danger" />}
                </div>
                {d.serviceInterest && (
                  <div className="truncate text-xs text-muted-foreground">{d.serviceInterest}</div>
                )}
              </div>
            </div>
          )}
        />
      )}

      {total > 0 && (
        <div className="border-t px-3 py-2">
          <Pager offset={offset} pageSize={LIST_PAGE_SIZE} total={total} onOffset={setOffset} />
        </div>
      )}
    </Card>
  );
}
