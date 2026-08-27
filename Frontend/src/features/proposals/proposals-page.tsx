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
import { money, relDay } from "@/lib/format";
import { addDays } from "@/lib/dates";
import { useLeads, useProposals, useSession } from "@/store";
import { PROPOSAL_STATUSES, type ProposalStatus } from "@/types";

export function ProposalsPage() {
  const { proposals, addProposal, updateProposal } = useProposals();
  const { leads, updateLead } = useLeads();
  const { userName, currentUser } = useSession();
  const [uploadOpen, setUploadOpen] = useState(false);

  const pipelineValue = proposals
    .filter((p) => p.status === "Sent" || p.status === "Pending")
    .reduce((s, p) => s + (p.amount ?? 0), 0);

  const setStatus = (id: string, status: ProposalStatus) => {
    const p = proposals.find((x) => x.id === id);
    if (!p) return;
    updateProposal(id, {
      status,
      ...(status === "Sent"
        ? { sentDate: `${new Date().toISOString().slice(0, 10)}`, followUpDate: addDays(3) }
        : {}),
    });
    if (status === "Sent" || status === "Pending")
      updateLead(p.leadId, {
        stage: status === "Sent" ? "Proposal Pending" : "Proposal Pending",
        nextAction: {
          type: "Proposal Follow-up",
          title: "Follow up on proposal",
          dueAt: addDays(3),
          ownerId: p.ownerId,
        },
      });
    if (status === "Accepted")
      updateLead(p.leadId, { stage: "Won", nextAction: null, automation: "Stopped" });
    if (status === "Rejected")
      updateLead(p.leadId, {
        stage: "Long-Term Nurture",
        nextAction: {
          type: "Follow-up",
          title: "Re-engage after rejection",
          dueAt: addDays(45),
          ownerId: p.ownerId,
        },
      });
    toast.success(`Proposal marked ${status}`);
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Proposals"
        description="Manual upload, simple statuses, clear follow-up dates."
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
              proposals.filter((p) => p.status !== "Accepted" && p.status !== "Rejected").length,
            )}
          />
          <Stat
            label="Awaiting decision"
            value={String(proposals.filter((p) => p.status === "Pending").length)}
          />
          <Stat label="Value in play" value={money(pipelineValue)} />
        </div>

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
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const lead = leads.find((l) => l.id === p.leadId);
                  return (
                    <tr key={p.id} className="border-t hover:bg-accent/40">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.title}</div>
                        <div className="text-xs text-muted-foreground">{p.fileName}</div>
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
                      <td className="px-3 py-2 text-xs">{userName(p.ownerId)}</td>
                      <td className="num px-3 py-2">{p.amount ? money(p.amount) : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge value={p.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {p.sentDate ? relDay(`${p.sentDate}T10:00:00`) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {p.followUpDate ? relDay(p.followUpDate) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={p.status}
                          onValueChange={(v) => setStatus(p.id, v as ProposalStatus)}
                        >
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROPOSAL_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSave={(v) => {
          addProposal({
            leadId: v.leadId,
            ownerId: currentUser.id,
            title: v.title,
            fileName: v.fileName,
            amount: v.amount ? Number(v.amount) : undefined,
            status: "Draft",
            notes: v.notes,
            updatedAt: `${new Date().toISOString().slice(0, 10)}T12:00:00`,
          });
          updateLead(v.leadId, { stage: "Proposal Preparation" });
          toast.success("Proposal uploaded");
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="num text-2xl font-semibold leading-none">{value}</div>
        <div className="pt-1 text-xs text-muted-foreground">{label}</div>
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
  onOpenChange: (v: boolean) => void;
  onSave: (v: {
    leadId: string;
    title: string;
    fileName: string;
    amount: string;
    notes: string;
  }) => void;
}) {
  const { leads } = useLeads();
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const [title, setTitle] = useState("Sales Automation Proposal");
  const [fileName, setFileName] = useState("proposal-v1.pdf");
  const [amount, setAmount] = useState("450000");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload proposal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Lead</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.firstName} {l.lastName} · {l.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">File</Label>
              <Input value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Amount (₹)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!leadId || !title.trim()}
            onClick={() => {
              onSave({ leadId, title: title.trim(), fileName, amount, notes });
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
