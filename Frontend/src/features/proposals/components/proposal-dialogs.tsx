import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { PickerOption } from "@/components/common/search-picker";
import { backend } from "@/lib/backend-client";
import { label } from "@/lib/labels";
import { messageFromError, useAutomations, useCrmMutation } from "@/store";
import { LEAD_LOSS_REASONS, type LeadLossReason, type Proposal } from "@/types";
import { ErrorNotice } from "@/features/contacts/contact-dialogs";
import { DealPicker } from "@/features/contacts/pickers";
import { NATIVE_SELECT, cn } from "@/lib/utils";

const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** A file input that refuses files over 10MB (the backend limit). */
function DocumentInput({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (next && next.size > MAX_DOCUMENT_BYTES) {
      toast.error("The proposal document must be under 10MB.");
      return;
    }
    onFile(next);
  };
  return file ? (
    <div className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
      <span className="truncate">{file.name}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onFile(null)}
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
        onChange={pick}
        aria-label="Proposal document"
      />
    </label>
  );
}

/**
 * Creates a proposal, then uploads its document if one was chosen. Without `dealId` it asks
 * for a deal. Mounted only while open.
 */
export function NewProposalDialog({
  dealId,
  onOpenChange,
}: {
  dealId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [deal, setDeal] = useState<PickerOption | null>(null);
  const [title, setTitle] = useState("Sales proposal");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const create = useCrmMutation(async () => {
    const proposal = await backend.proposals.create({
      dealId: (dealId ?? deal?.id)!,
      title: title.trim(),
      amount: amount ? Number(amount) : undefined,
      notes: notes.trim() || undefined,
    });
    if (!file) return proposal;
    // The proposal exists now; a failed upload must not hide that.
    return backend.proposals.uploadDocument(proposal.id, file).catch((error: unknown) => {
      toast.error(`Proposal created, but the document upload failed: ${messageFromError(error)}`);
      return proposal;
    });
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create proposal</DialogTitle>
          <DialogDescription>
            Upload the document now or later. Send it once it has a document.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!dealId && (
            <div>
              <Label className="mb-1.5 block text-xs">Deal</Label>
              <DealPicker value={deal} onChange={setDeal} />
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Amount (₹, optional)</Label>
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Document (optional)</Label>
            <DocumentInput file={file} onFile={setFile} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <ErrorNotice error={create.error} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!(dealId ?? deal) || !title.trim() || create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: () => {
                  toast.success("Proposal created");
                  onOpenChange(false);
                },
              })
            }
          >
            {create.isPending ? "Saving…" : "Create proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uploads (or replaces) a proposal's document. Mounted only while open. */
export function UploadDocumentDialog({
  proposal,
  onOpenChange,
}: {
  proposal: Proposal;
  onOpenChange: (open: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useCrmMutation((f: File) => backend.proposals.uploadDocument(proposal.id, f));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document - {proposal.title}</DialogTitle>
        </DialogHeader>
        <DocumentInput file={file} onFile={setFile} />
        <ErrorNotice error={upload.error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!file || upload.isPending}
            onClick={() =>
              file &&
              upload.mutate(file, {
                onSuccess: () => {
                  toast.success("Document uploaded");
                  onOpenChange(false);
                },
              })
            }
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NONE = "none";

/** Sends the proposal document by email and/or WhatsApp. Mounted only while open. */
export function SendProposalDialog({
  proposal,
  onOpenChange,
}: {
  proposal: Proposal;
  onOpenChange: (open: boolean) => void;
}) {
  const { templates } = useAutomations();
  const [emailTemplateId, setEmailTemplateId] = useState(NONE);
  const [whatsappTemplateId, setWhatsappTemplateId] = useState(NONE);
  const send = useCrmMutation(() =>
    backend.proposals.send(proposal.id, {
      ...(emailTemplateId !== NONE ? { emailTemplateId } : {}),
      ...(whatsappTemplateId !== NONE ? { whatsappTemplateId } : {}),
    }),
  );
  const picker = (type: "email" | "whatsapp", value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={`${label(type)} template`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Don&apos;t send</SelectItem>
        {templates
          .filter((t) => t.type === type && t.active)
          .map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open onOpenChange={(open) => !send.isPending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send proposal - {proposal.title}</DialogTitle>
          <DialogDescription>
            Sends {proposal.fileName ?? "the document"} with the chosen templates.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block text-xs">Email template</Label>
            {picker("email", emailTemplateId, setEmailTemplateId)}
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">WhatsApp template</Label>
            {picker("whatsapp", whatsappTemplateId, setWhatsappTemplateId)}
          </div>
        </div>
        <ErrorNotice error={send.error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            disabled={(emailTemplateId === NONE && whatsappTemplateId === NONE) || send.isPending}
            onClick={() =>
              send.mutate(undefined, {
                onSuccess: (sent) => {
                  onOpenChange(false);
                  toast.success("Proposal sent");
                  if (sent.emailSendStatus === "skipped")
                    toast.warning("Email skipped - the contact can't be emailed.");
                  if (sent.emailSendStatus === "failed")
                    toast.error(
                      `Email failed to send${sent.emailSendError ? `: ${sent.emailSendError}` : "."}`,
                    );
                  if (sent.whatsappSendStatus === "skipped")
                    toast.warning("WhatsApp skipped - the contact can't be messaged.");
                },
              })
            }
          >
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Picks a loss reason (required) and optional notes: for a lost deal and for a rejected or
 * expired proposal. Mounted only while open; shows the backend error in the dialog.
 */
export function LossReasonDialog({
  title,
  confirm,
  onConfirm,
  onOpenChange,
}: {
  title: string;
  confirm: string;
  onConfirm: (reason: LeadLossReason, notes: string) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<LeadLossReason | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>A loss reason is required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Loss reason</Label>
            <select
              aria-label="Loss reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as LeadLossReason)}
              className={cn(NATIVE_SELECT, "h-9 w-full px-2 text-sm")}
            >
              <option value="">Choose a reason</option>
              {LEAD_LOSS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <ErrorNotice error={error} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || saving}
            onClick={() => {
              if (!reason) return;
              setSaving(true);
              setError(null);
              onConfirm(reason, notes.trim())
                .then(() => onOpenChange(false))
                .catch(setError)
                .finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
