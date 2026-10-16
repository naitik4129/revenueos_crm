import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { messageFromError, useContactMutation } from "@/store";
import {
  CONTACT_CHANNELS,
  LIFECYCLE_STAGES,
  type Contact,
  type ContactChannel,
  type LifecycleStage,
} from "@/types";
import { ContactPicker } from "./pickers";

/** Mirrors Backend CONTACT_CHANNEL_STATUS. */
const CHANNEL_STATUSES: Record<ContactChannel, string[]> = {
  phone: [
    "valid",
    "reachable",
    "temporarily_unreachable",
    "invalid",
    "wrong_number",
    "do_not_contact",
  ],
  email: ["valid", "delivered", "temporary_bounce", "permanent_bounce", "unsubscribed", "invalid"],
  whatsapp: [
    "valid",
    "reachable",
    "temporarily_unreachable",
    "invalid",
    "opted_out",
    "do_not_contact",
  ],
};

/** Shows an error message in the dialog itself (not a toast), so it cannot be missed. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{messageFromError(error)}</span>
    </div>
  );
}

function Shell({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirm,
  disabled,
  pending,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  confirm: string;
  disabled?: boolean;
  pending?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={disabled || pending}
            onClick={onConfirm}
          >
            {pending ? "Saving…" : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The page mounts each dialog only while it is open, so state starts fresh every time.
type DialogProps = { contact: Contact; open: boolean; onOpenChange: (open: boolean) => void };

/** Puts the contact on Do Not Contact, or lifts it. A reason is required either way. */
export function DncDialog({ contact, open, onOpenChange }: DialogProps) {
  const [reason, setReason] = useState("");
  const lifting = contact.doNotContact;
  const save = useContactMutation((text: string) =>
    lifting
      ? backend.contacts.reactivateFromDnc(contact.id, text)
      : backend.contacts.markDnc(contact.id, text),
  );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={lifting ? "Lift Do Not Contact" : "Mark Do Not Contact"}
      description={
        lifting
          ? "The contact can be contacted again. Automation stays stopped until someone restarts it."
          : "Blocks every send to this contact and stops automation on its deals. Open deals stay open."
      }
      confirm={lifting ? "Lift DNC" : "Mark DNC"}
      destructive={!lifting}
      disabled={!reason.trim()}
      pending={save.isPending}
      onConfirm={() =>
        save.mutate(reason.trim(), {
          onSuccess: () => {
            toast.success(lifting ? "Do Not Contact lifted" : "Marked Do Not Contact");
            onOpenChange(false);
          },
        })
      }
    >
      <div>
        <Label className="mb-1.5 block text-xs">Reason</Label>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ErrorNotice error={save.error} />
    </Shell>
  );
}

/** Forward moves are open to everyone; moving back is admin-only and needs a note. */
export function LifecycleDialog({
  contact,
  open,
  onOpenChange,
  isAdmin,
}: DialogProps & { isAdmin: boolean }) {
  const [stage, setStage] = useState<LifecycleStage>(contact.lifecycleStage);
  const [note, setNote] = useState("");
  const save = useContactMutation(() =>
    backend.contacts.setLifecycle(contact.id, stage, note.trim() || undefined),
  );

  const current = LIFECYCLE_STAGES.indexOf(contact.lifecycleStage);
  const backwards = LIFECYCLE_STAGES.indexOf(stage) < current;

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title="Change lifecycle stage"
      description="The stage moves forward on its own as the contact is contacted, engages, qualifies and buys."
      confirm="Save stage"
      disabled={stage === contact.lifecycleStage || (backwards && !note.trim())}
      pending={save.isPending}
      onConfirm={() =>
        save.mutate(undefined, {
          onSuccess: () => {
            toast.success(`Lifecycle stage: ${label(stage)}`);
            onOpenChange(false);
          },
        })
      }
    >
      <div>
        <Label className="mb-1.5 block text-xs">Stage</Label>
        <Select value={stage} onValueChange={(v) => setStage(v as LifecycleStage)}>
          <SelectTrigger aria-label="Stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIFECYCLE_STAGES.map((s, i) => (
              <SelectItem key={s} value={s} disabled={i < current && !isAdmin}>
                {label(s)}
                {i < current && !isAdmin ? " (admins only)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {backwards && (
        <div>
          <Label className="mb-1.5 block text-xs">
            Note (required to move back; added to the timeline)
          </Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <ErrorNotice error={save.error} />
    </Shell>
  );
}

export function ContactabilityDialog({ contact, open, onOpenChange }: DialogProps) {
  const [channel, setChannel] = useState<ContactChannel>("phone");
  const [status, setStatus] = useState("valid");
  const [reason, setReason] = useState("");
  const save = useContactMutation(() =>
    backend.contacts.setContactability(contact.id, {
      channel,
      status,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
  );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title="Update contactability"
      description="Record whether a channel works for this contact. Blocked channels are skipped by every send."
      confirm="Save"
      pending={save.isPending}
      onConfirm={() =>
        save.mutate(undefined, {
          onSuccess: () => {
            toast.success("Contactability updated");
            onOpenChange(false);
          },
        })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1.5 block text-xs">Channel</Label>
          <Select
            value={channel}
            onValueChange={(v) => {
              setChannel(v as ContactChannel);
              setStatus("valid");
            }}
          >
            <SelectTrigger aria-label="Channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {label(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_STATUSES[channel].map((s) => (
                <SelectItem key={s} value={s}>
                  {label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">Reason (optional)</Label>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ErrorNotice error={save.error} />
    </Shell>
  );
}

/**
 * Merges this contact (the duplicate) into another one. The backend refuses (409) when both
 * have an open deal; that message is shown in the dialog.
 */
export function MergeDialog({ contact, open, onOpenChange }: DialogProps) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<PickerOption | null>(null);
  const [reason, setReason] = useState("");
  const save = useContactMutation((targetId: string) =>
    backend.contacts.merge(contact.id, targetId, reason.trim() || undefined),
  );

  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={`Merge ${name} into another contact`}
      description="This contact's deals, calls, notes, tasks, emails and timeline move to the chosen contact, and this one is marked merged. If either is Do Not Contact, the result is Do Not Contact. This cannot be undone."
      confirm="Merge"
      destructive
      disabled={!target}
      pending={save.isPending}
      onConfirm={() =>
        target &&
        save.mutate(target.id, {
          onSuccess: (merged) => {
            toast.success(`Merged into ${merged.firstName} ${merged.lastName}`.trim());
            onOpenChange(false);
            void navigate({ to: "/contacts/$contactId", params: { contactId: merged.id } });
          },
        })
      }
    >
      <div>
        <Label className="mb-1.5 block text-xs">Keep this contact</Label>
        <ContactPicker value={target} onChange={setTarget} excludeId={contact.id} />
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">Reason (optional)</Label>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ErrorNotice error={save.error} />
    </Shell>
  );
}
