import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { backend, type LogCallInput } from "@/lib/backend-client";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { messageFromError, useCrmMutation } from "@/store";
import {
  CALL_CONNECTED_OUTCOMES,
  CALL_NOT_CONNECTED_REASONS,
  type CallConnectedOutcome,
  type CallNotConnectedReason,
  type Contact,
  type LogCallResult,
} from "@/types";
import { describeDealResult } from "./call-result";

export function LogCallDialog({
  contact,
  dealIds,
  open,
  onOpenChange,
}: {
  contact: Contact;
  /** The contact's deals before the call, to tell a new deal from a reopened one. */
  dealIds: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<CallNotConnectedReason>("no_answer");
  const [outcome, setOutcome] = useState<CallConnectedOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState(dateInputValue(1));
  const [later, setLater] = useState({
    reason: "",
    restartAt: "",
    nextAction: "",
    decisionOwner: "",
  });
  const [result, setResult] = useState<LogCallResult | null>(null);
  const logCall = useCrmMutation((input: LogCallInput) =>
    backend.contacts.logCall(contact.id, input),
  );

  const reset = () => {
    setConnected(null);
    setOutcome(null);
    setNotes("");
    setReason("no_answer");
    setCallbackAt(dateInputValue(1));
    setLater({ reason: "", restartAt: "", nextAction: "", decisionOwner: "" });
    setResult(null);
  };
  const close = (value: boolean) => {
    onOpenChange(value);
    if (!value) reset();
  };
  const canSave =
    connected === false ||
    (connected === true &&
      outcome !== null &&
      (outcome !== "callback_requested" || Boolean(callbackAt)));

  const save = async () => {
    if (connected === null) return;
    try {
      const saved = await logCall.mutateAsync({
        connected,
        ...(connected
          ? { connectedOutcome: outcome ?? undefined }
          : { notConnectedReason: reason }),
        notes: notes.trim() || undefined,
        ...(connected && outcome === "callback_requested"
          ? { callbackDueAt: toIsoFromIst(callbackAt) }
          : {}),
        ...(connected && outcome === "interested_later"
          ? {
              interestedLater: {
                reason: later.reason.trim() || undefined,
                restartAt: later.restartAt || undefined,
                nextAction: later.nextAction.trim() || undefined,
                decisionOwner: later.decisionOwner.trim() || undefined,
              },
            }
          : {}),
      });
      toast.success("Call logged");
      setResult(saved);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };

  const name = `${contact.firstName} ${contact.lastName}`.trim();
  const dealNote = result ? describeDealResult(result, dealIds, contact.openDealId) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log call - {name}</DialogTitle>
          <DialogDescription>
            The call is always saved. If the outcome moves the pipeline and there is no open deal,
            the parked deal is reopened or a new deal is opened.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm" role="status">
            <p className="font-medium">
              Call saved:{" "}
              {result.call.connected
                ? label(result.call.connectedOutcome)
                : `Not connected (${label(result.call.notConnectedReason)})`}
            </p>
            {result.contact.doNotContact && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                The contact is now Do Not Contact. All sends and automation are stopped.
              </p>
            )}
            {result.deal && dealNote ? (
              <div className="rounded-md border px-3 py-2">
                <div className="font-medium">{dealNote}</div>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                  Stage <StatusBadge value={result.deal.stage} /> · Automation{" "}
                  <StatusBadge value={result.deal.automationMode} dot />
                  {result.deal.nextAction && <span>· Next: {result.deal.nextAction.title}</span>}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No deal was changed (contact-level outcome).</p>
            )}
            {result.promptScheduleMeeting && <p>Next step: schedule the meeting from the deal.</p>}
            {result.workflowTrigger && (
              <p>
                Suggested nurture workflow:{" "}
                <span className="font-medium">{label(result.workflowTrigger)}</span>. Enroll it from
                the deal.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block text-xs">Did the call connect?</Label>
              <div className="flex gap-2">
                <Choice
                  active={connected === true}
                  onClick={() => setConnected(true)}
                  label="Connected"
                />
                <Choice
                  active={connected === false}
                  onClick={() => {
                    setConnected(false);
                    setOutcome(null);
                  }}
                  label="Not connected"
                />
              </div>
            </div>
            {connected === false && (
              <div>
                <Label className="mb-1.5 block text-xs">Reason</Label>
                <Select
                  value={reason}
                  onValueChange={(v) => setReason(v as CallNotConnectedReason)}
                >
                  <SelectTrigger aria-label="Reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_NOT_CONNECTED_REASONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {label(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {connected === true && (
              <div>
                <Label className="mb-2 block text-xs">Outcome</Label>
                <div className="flex flex-wrap gap-2">
                  {CALL_CONNECTED_OUTCOMES.map((v) => (
                    <Choice
                      key={v}
                      active={outcome === v}
                      onClick={() => setOutcome(v)}
                      label={label(v)}
                    />
                  ))}
                </div>
              </div>
            )}
            {outcome === "callback_requested" && (
              <div>
                <Label className="mb-1.5 block text-xs">Callback date</Label>
                <Input
                  type="date"
                  min={dateInputValue()}
                  value={callbackAt}
                  onChange={(e) => setCallbackAt(e.target.value)}
                />
              </div>
            )}
            {outcome === "interested_later" && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <LaterField
                  label="Reason for delay"
                  value={later.reason}
                  onChange={(v) => setLater({ ...later, reason: v })}
                />
                <div>
                  <Label className="mb-1.5 block text-xs">Expected restart date</Label>
                  <Input
                    type="date"
                    min={dateInputValue()}
                    value={later.restartAt}
                    onChange={(e) => setLater({ ...later, restartAt: e.target.value })}
                  />
                </div>
                <LaterField
                  label="Next planned action"
                  value={later.nextAction}
                  onChange={(v) => setLater({ ...later, nextAction: v })}
                />
                <LaterField
                  label="Decision owner"
                  value={later.decisionOwner}
                  onChange={(v) => setLater({ ...later, decisionOwner: v })}
                />
              </div>
            )}
            <div>
              <Label className="mb-1.5 block text-xs">Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button disabled={!canSave || logCall.isPending} onClick={() => void save()}>
                {logCall.isPending ? "Saving…" : "Save call"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LaterField({
  label: text,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs">{text}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Choice({
  label: text,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent",
        active && "border-primary bg-primary/10 font-medium text-primary",
      )}
    >
      {text}
    </button>
  );
}
