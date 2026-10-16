import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { money, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { messageFromError, useProposals, useSession } from "@/store";
import { PROPOSAL_STATUSES, type Proposal, type ProposalStatus } from "@/types";
import { DealLink } from "@/features/deals/deal-link";
import {
  LossReasonDialog,
  NewProposalDialog,
  SendProposalDialog,
} from "./components/proposal-dialogs";

export function ProposalsPage() {
  const store = useProposals();
  const { userName } = useSession();
  const [newOpen, setNewOpen] = useState(false);
  const [sending, setSending] = useState<Proposal | null>(null);
  // Rejected / expired need a loss reason first.
  const [losing, setLosing] = useState<{ proposal: Proposal; status: ProposalStatus } | null>(null);
  const pipelineValue = store.proposals
    .filter((proposal) => ["sent", "revision_requested", "revised"].includes(proposal.status))
    .reduce((sum, proposal) => sum + (proposal.amount ?? 0), 0);
  const setStatus = async (id: string, status: ProposalStatus) => {
    if (status === "rejected" || status === "expired") {
      const proposal = store.proposals.find((p) => p.id === id);
      if (proposal) setLosing({ proposal, status });
      return;
    }
    try {
      await store.setProposalStatus(id, status);
      toast.success(`Proposal marked ${label(status)}`);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };
  return (
    <div className="pb-10">
      <PageHeader
        title="Proposals"
        description="Every proposal in this workspace. Create one, upload its document, then send it by email and/or WhatsApp."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Send className="mr-1 size-4" /> New proposal
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Open proposals"
            value={String(
              store.proposals.filter(
                (proposal) =>
                  !["accepted", "rejected", "withdrawn", "expired"].includes(proposal.status),
              ).length,
            )}
          />
          <Stat
            label="Awaiting decision"
            value={String(store.proposals.filter((proposal) => proposal.status === "sent").length)}
          />
          <Stat label="Value in play" value={money(pipelineValue)} />
        </div>
        {store.isLoading ? (
          <LoadingBlock label="Loading proposals…" />
        ) : store.error ? (
          <ErrorBlock error={store.error} />
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Proposal",
                      "Deal",
                      "Owner",
                      "Amount",
                      "Status",
                      "Channels",
                      "Sent",
                      "Follow-up",
                      "Decision",
                    ].map((heading) => (
                      <th key={heading} className="px-3 py-2 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {store.proposals.map((proposal) => {
                    return (
                      <tr key={proposal.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{proposal.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {proposal.fileName || "No document"}
                          </div>
                          {proposal.fileName && (
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline"
                              onClick={() => setSending(proposal)}
                            >
                              Send
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <DealLink dealId={proposal.dealId} />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {proposal.ownerName ?? userName(proposal.ownerId)}
                        </td>
                        <td className="num px-3 py-2">
                          {proposal.amount ? money(proposal.amount) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge value={proposal.status} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1 text-xs">
                            {proposal.emailSendStatus !== "not_applicable" && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted-foreground">Email</span>
                                <StatusBadge
                                  value={proposal.emailSendStatus}
                                  tone={channelTone(proposal.emailSendStatus)}
                                />
                              </div>
                            )}
                            {proposal.whatsappSendStatus !== "not_applicable" && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted-foreground">WhatsApp</span>
                                <StatusBadge
                                  value={proposal.whatsappSendStatus}
                                  tone={channelTone(proposal.whatsappSendStatus)}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {proposal.sentDate ? relDay(proposal.sentDate) : "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {proposal.followUpDate ? relDay(proposal.followUpDate) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={proposal.status}
                            disabled={store.isPending}
                            onValueChange={(value) =>
                              void setStatus(proposal.id, value as ProposalStatus)
                            }
                          >
                            <SelectTrigger className="h-8 w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROPOSAL_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {label(status)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                  {store.proposals.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        No proposals.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
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

function channelTone(status: string): "success" | "danger" | "muted" | "info" {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "muted";
  return "info";
}

function Stat({ label: name, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="num text-2xl font-semibold leading-none">{value}</div>
        <div className="pt-1 text-xs text-muted-foreground">{name}</div>
      </CardContent>
    </Card>
  );
}
