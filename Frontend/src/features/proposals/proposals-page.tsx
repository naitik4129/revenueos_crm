import { useState } from "react";
import { toast } from "sonner";
import { FileText, Hourglass, IndianRupee } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RelTime,
  ColumnChooser,
  FilterSelect,
  ListEmptyState,
  Pager,
  RecordTable,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { money, tabLabel } from "@/lib/format";
import { label } from "@/lib/labels";
import { useStoredColumns } from "@/lib/use-stored-columns";
import { messageFromError, useProposalSummary, useProposals, useSession } from "@/store";
import { PROPOSAL_STATUSES, type Proposal, type ProposalStatus } from "@/types";
import { DealLink } from "@/features/deals/deal-link";
import {
  LossReasonDialog,
  NewProposalDialog,
  SendProposalDialog,
} from "./components/proposal-dialogs";
import { countLabel } from "@/lib/format";
import { StatCard } from "@/components/common/record-parts";

const PAGE_SIZE = 50;
const ALL = "all";

// The server filters on one status; tabs cover the common ones, the Status filter all of them.
const VIEWS = [
  { id: ALL, label: "All" },
  { id: "ready_to_send", label: "Ready to send" },
  { id: "sent", label: "Sent" },
  { id: "revision_requested", label: "Revision requested" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

export function ProposalsPage({ initialView }: { initialView?: string | undefined } = {}) {
  const [status, setStatus] = useState<string>(
    PROPOSAL_STATUSES.includes(initialView as ProposalStatus) ? initialView! : ALL,
  );
  const [owner, setOwner] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const store = useProposals({
    status: status === ALL ? undefined : status,
    ownerId: owner === ALL ? undefined : owner,
    limit: PAGE_SIZE,
    offset,
  });
  // The stat cards cover the whole workspace, not just this page.
  const summary = useProposalSummary().data;
  const { users, userName, readOnly } = useSession();
  const [newOpen, setNewOpen] = useState(false);
  const [sending, setSending] = useState<Proposal | null>(null);
  // Rejected / expired need a loss reason first.
  const [losing, setLosing] = useState<{ proposal: Proposal; status: ProposalStatus } | null>(null);
  const [visible, setVisible] = useStoredColumns("proposals.columns", DEFAULT_COLUMNS);
  const filter = (next: { status?: string; owner?: string }) => {
    if (next.status !== undefined) setStatus(next.status);
    if (next.owner !== undefined) setOwner(next.owner);
    setOffset(0);
  };

  const decide = async (id: string, next: ProposalStatus) => {
    if (next === "rejected" || next === "expired") {
      const proposal = store.proposals.find((p) => p.id === id);
      if (proposal) setLosing({ proposal, status: next });
      return;
    }
    try {
      await store.setProposalStatus(id, next);
      toast.success(`Proposal marked ${label(next)}`);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };

  const columns: ListColumn<Proposal>[] = [
    {
      id: "deal",
      label: "Deal",
      cell: (p) => (
        <DealLink dealId={p.dealId} contactName={p.contactName} companyName={p.companyName} />
      ),
    },
    { id: "owner", label: "Owner", cell: (p) => p.ownerName ?? userName(p.ownerId) },
    {
      id: "amount",
      label: "Amount",
      cell: (p) => (p.amount ? <span className="num">{money(p.amount)}</span> : undefined),
    },
    { id: "status", label: "Status", cell: (p) => <StatusBadge value={p.status} /> },
    {
      id: "channels",
      label: "Channels",
      cell: (p) =>
        p.emailSendStatus === "not_applicable" &&
        p.whatsappSendStatus === "not_applicable" ? undefined : (
          <div className="flex flex-col gap-1">
            {p.emailSendStatus !== "not_applicable" && (
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Email</span>
                <StatusBadge value={p.emailSendStatus} tone={channelTone(p.emailSendStatus)} />
              </span>
            )}
            {p.whatsappSendStatus !== "not_applicable" && (
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">WhatsApp</span>
                <StatusBadge
                  value={p.whatsappSendStatus}
                  tone={channelTone(p.whatsappSendStatus)}
                />
              </span>
            )}
          </div>
        ),
    },
    { id: "sent", label: "Sent", cell: (p) => p.sentDate && <RelTime iso={p.sentDate} /> },
    {
      id: "followUp",
      label: "Follow-up",
      cell: (p) => p.followUpDate && <RelTime iso={p.followUpDate} />,
    },
    {
      id: "decision",
      label: "Decision",
      cell: (p) => (
        <Select
          value={p.status}
          disabled={store.isPending}
          onValueChange={(value) => void decide(p.id, value as ProposalStatus)}
        >
          <SelectTrigger className="h-7 w-40 text-xs" aria-label={`Decision for ${p.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROPOSAL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {label(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Proposals"
        count={store.isLoading ? undefined : countLabel(store.total, "proposal")}
        actions={
          readOnly ? undefined : (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              Create proposal
            </Button>
          )
        }
        tabs={
          <ViewTabs
            views={VIEWS.map((v) => ({ ...v, label: tabLabel(v.label, store.statusCounts, v.id) }))}
            active={VIEWS.some((v) => v.id === status) ? status : null}
            onSelect={(id) => filter({ status: id })}
          />
        }
      />
      <div className="space-y-4 px-6 py-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard icon={FileText} label="Open proposals" value={summary ? summary.open : "…"} />
          <StatCard
            icon={Hourglass}
            label="Awaiting decision"
            value={summary ? summary.awaitingDecision : "…"}
          />
          <StatCard
            icon={IndianRupee}
            label="Value in play"
            value={summary ? money(summary.valueInPlay) : "…"}
          />
        </div>

        <Card className="overflow-hidden p-0">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => filter({ status: v })}
              options={[
                [ALL, "All statuses"],
                ...PROPOSAL_STATUSES.map((s) => [s, label(s)] as const),
              ]}
            />
            <FilterSelect
              label="Owner"
              value={owner}
              onChange={(v) => filter({ owner: v })}
              options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
            />
            <div className="ml-auto">
              <ColumnChooser columns={columns} visible={visible} onChange={setVisible} />
            </div>
          </div>

          {store.isLoading ? (
            <LoadingBlock label="Loading proposals…" />
          ) : store.error ? (
            <ErrorBlock error={store.error} />
          ) : store.proposals.length === 0 ? (
            <ListEmptyState
              icon={FileText}
              title={status === ALL && owner === ALL ? "No proposals yet" : "No proposals here."}
              text="A proposal belongs to a deal: create it, upload its document, then send it by email and/or WhatsApp."
            >
              {!readOnly && (
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  Create proposal
                </Button>
              )}
            </ListEmptyState>
          ) : (
            <RecordTable
              rows={store.proposals}
              columns={columns.filter((c) => visible.includes(c.id))}
              nameHeader="Proposal"
              rowLabel={(p) => p.title}
              name={(p) => (
                <div>
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.fileName || "No document"}
                    {p.fileName && !readOnly && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => setSending(p)}
                        >
                          Send
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            />
          )}

          {store.total > 0 && (
            <div className="border-t px-3 py-2">
              <Pager
                offset={offset}
                pageSize={PAGE_SIZE}
                total={store.total}
                onOffset={setOffset}
              />
            </div>
          )}
        </Card>
      </div>
      {newOpen && <NewProposalDialog onOpenChange={setNewOpen} />}
      {sending && <SendProposalDialog proposal={sending} onOpenChange={() => setSending(null)} />}
      {losing && (
        <LossReasonDialog
          title={`Mark proposal ${label(losing.status)}`}
          confirm={`Mark ${label(losing.status)}`}
          onConfirm={(reason, notes) =>
            store.setProposalStatus(losing.proposal.id, losing.status, reason, notes || undefined)
          }
          onOpenChange={() => setLosing(null)}
        />
      )}
    </div>
  );
}

const DEFAULT_COLUMNS = ["deal", "owner", "amount", "status", "channels", "sent", "decision"];

function channelTone(status: string): "success" | "danger" | "muted" | "info" {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "muted";
  return "info";
}
