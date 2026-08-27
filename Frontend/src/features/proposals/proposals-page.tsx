import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
        description="Manual document references, real statuses, and backend-owned outcome routing."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-1 size-4" /> Upload proposal
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
                            {proposal.fileName || "No document reference"}
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
                          {proposal.amount ? money(proposal.amount) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge value={proposal.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {proposal.sentDate ? relDay(proposal.sentDate) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {proposal.followUpDate ? relDay(proposal.followUpDate) : "—"}
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
                        colSpan={8}
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
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSave={(value) => {
          void store
            .addProposal({
              leadId: value.leadId,
              title: value.title,
              fileName: value.fileName || undefined,
              amount: value.amount ? Number(value.amount) : undefined,
              notes: value.notes || undefined,
            })
            .then(() => toast.success("Proposal uploaded"))
            .catch((error) => toast.error(messageFromError(error)));
        }}
      />
    </div>
  );
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
function UploadDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSave: (value: {
    leadId: string;
    title: string;
    fileName: string;
    amount: string;
    notes: string;
  }) => void;
}) {
  const { leads } = useLeads();
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("Sales Automation Proposal");
  const [fileName, setFileName] = useState("proposal-v1.pdf");
  const [amount, setAmount] = useState("450000");
  const [notes, setNotes] = useState("");
  const selectedLead = leadId || leads[0]?.id || "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload proposal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Lead</Label>
            <Select value={selectedLead} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.firstName} {lead.lastName} · {lead.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Document reference</Label>
              <Input value={fileName} onChange={(event) => setFileName(event.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Amount (₹)</Label>
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selectedLead || !title.trim()}
            onClick={() => {
              onSave({ leadId: selectedLead, title: title.trim(), fileName, amount, notes });
              onOpenChange(false);
            }}
          >
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
