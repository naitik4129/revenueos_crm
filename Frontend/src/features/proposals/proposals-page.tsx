import { useState } from "react";
import { Link } from "@tanstack/react-router";
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
import { messageFromError, useLeads, useProposals, useSession } from "@/store";
import { PROPOSAL_STATUSES, type ProposalStatus } from "@/types";
import { SendProposalDialog } from "@/features/proposals/components/send-proposal-dialog";

export function ProposalsPage() {
  const store = useProposals();
  const { leads } = useLeads();
  const { userName } = useSession();
  const [uploadOpen, setUploadOpen] = useState(false);
  const pipelineValue = store.proposals
    .filter((proposal) => ["sent", "revision_requested", "revised"].includes(proposal.status))
    .reduce((sum, proposal) => sum + (proposal.amount ?? 0), 0);
  const setStatus = async (id: string, status: ProposalStatus) => {
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
        description="Attach a document, pick an email and WhatsApp template, and send both in one click."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Send className="mr-1 size-4" /> Send proposal
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
                      "Lead",
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
                    const lead = leads.find((item) => item.id === proposal.leadId);
                    return (
                      <tr key={proposal.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{proposal.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {proposal.fileName || "No document"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {lead && (
                            <Link
                              to="/leads/$leadId"
                              params={{ leadId: lead.id }}
                              className="hover:underline"
                            >
                              {lead.firstName} {lead.lastName} · {lead.company}
                            </Link>
                          )}
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
      <SendProposalDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSend={(value) =>
          store.addProposal({
            leadId: value.leadId,
            title: value.title,
            amount: value.amount ? Number(value.amount) : undefined,
            notes: value.notes || undefined,
            emailTemplateId: value.emailTemplateId,
            whatsappTemplateId: value.whatsappTemplateId,
            document: value.document,
          })
        }
      />
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
