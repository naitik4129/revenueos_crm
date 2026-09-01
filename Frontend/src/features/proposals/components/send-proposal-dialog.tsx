import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { messageFromError, useAutomations, useLeads } from "@/store";
import type { Proposal } from "@/types";

const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface SendProposalValue {
  leadId: string;
  title: string;
  amount: string;
  notes: string;
  emailTemplateId: string;
  whatsappTemplateId: string;
  document: File;
}

export function SendProposalDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSend: (value: SendProposalValue) => Promise<Proposal>;
}) {
  const { leads } = useLeads();
  const { templates } = useAutomations();
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("Sales Automation Proposal");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [whatsappTemplateId, setWhatsappTemplateId] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loadedFor, setLoadedFor] = useState(false);

  // This dialog is always mounted (only `open` toggles) — without resetting
  // here, reopening "Send proposal" shows whatever was left over last time.
  if (open && !loadedFor) {
    setLoadedFor(true);
    setLeadId("");
    setTitle("Sales Automation Proposal");
    setAmount("");
    setNotes("");
    setEmailTemplateId("");
    setWhatsappTemplateId("");
    setDocumentFile(null);
  }
  if (!open && loadedFor) setLoadedFor(false);

  const selectedLead = leadId || leads[0]?.id || "";
  const emailTemplates = templates.filter((t) => t.type === "email" && t.active);
  const whatsappTemplates = templates.filter((t) => t.type === "whatsapp" && t.active);

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast.error("The proposal document must be under 10MB.");
      return;
    }
    setDocumentFile(file);
  }

  const canSend = Boolean(
    selectedLead &&
    title.trim() &&
    documentFile &&
    emailTemplateId &&
    whatsappTemplateId &&
    !sending,
  );

  async function handleSend() {
    if (!documentFile) return;
    setSending(true);
    try {
      const proposal = await onSend({
        leadId: selectedLead,
        title: title.trim(),
        amount,
        notes,
        emailTemplateId,
        whatsappTemplateId,
        document: documentFile,
      });
      onOpenChange(false);
      toast.success("Proposal sent");
      if (proposal.emailSendStatus === "skipped") {
        toast.warning("Email skipped — this lead has no email address.");
      } else if (proposal.emailSendStatus === "failed") {
        toast.error(
          `Email failed to send${proposal.emailSendError ? `: ${proposal.emailSendError}` : "."}`,
        );
      }
      if (proposal.whatsappSendStatus === "skipped") {
        toast.warning("WhatsApp skipped — this lead has no WhatsApp-capable phone number.");
      }
    } catch (err) {
      toast.error(messageFromError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !sending && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send proposal</DialogTitle>
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
          <div>
            <Label className="mb-1.5 block text-xs">Proposal document</Label>
            {documentFile ? (
              <div className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
                <span className="truncate">
                  {documentFile.name}{" "}
                  <span className="text-muted-foreground">({formatBytes(documentFile.size)})</span>
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setDocumentFile(null)}
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex h-9 cursor-pointer items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary">
                Choose a file…
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={handleFileSelected}
                />
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Email template</Label>
              <Select value={emailTemplateId} onValueChange={setEmailTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template" />
                </SelectTrigger>
                <SelectContent>
                  {emailTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">WhatsApp template</Label>
              <Select value={whatsappTemplateId} onValueChange={setWhatsappTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template" />
                </SelectTrigger>
                <SelectContent>
                  {whatsappTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Amount (₹) (optional)</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button disabled={!canSend} onClick={() => void handleSend()}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
