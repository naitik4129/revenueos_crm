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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import { label } from "@/lib/labels";
import { messageFromError, useLeads } from "@/store";
import {
  CALL_CONNECTED_OUTCOMES,
  CALL_NOT_CONNECTED_REASONS,
  type CallConnectedOutcome,
  type CallNotConnectedReason,
  type WorkflowTrigger,
} from "@/types";

export function LogCallDialog({
  leadId,
  taskId,
  open,
  onOpenChange,
  onEnrollPrompt,
  onScheduleMeetingPrompt,
}: {
  leadId: string;
  /** When set, saving this call also completes the open 'call' task that prompted it. */
  taskId?: string | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called instead of the plain success toast when the outcome moves the lead into nurture — the rep is always asked which workflow to enroll in, nothing is auto-enrolled silently. */
  onEnrollPrompt?: (trigger: WorkflowTrigger) => void;
  /** Called when the outcome is Positive — chains straight into scheduling a meeting instead of leaving the rep to notice the "Schedule discovery meeting" task on their own. */
  onScheduleMeetingPrompt?: () => void;
}) {
  const { getLead, logCall, isPending } = useLeads();
  const lead = getLead(leadId);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<CallNotConnectedReason>("no_answer");
  const [outcome, setOutcome] = useState<CallConnectedOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState(dateInputValue(1));
  // "Interested - Later" capture — only shown/sent when outcome is interested_later.
  const [interestedLaterReason, setInterestedLaterReason] = useState("");
  const [interestedLaterRestartAt, setInterestedLaterRestartAt] = useState("");
  const [interestedLaterNextAction, setInterestedLaterNextAction] = useState("");
  const [interestedLaterDecisionOwner, setInterestedLaterDecisionOwner] = useState("");
  const reset = () => {
    setConnected(null);
    setOutcome(null);
    setNotes("");
    setReason("no_answer");
    setCallbackAt(dateInputValue(1));
    setInterestedLaterReason("");
    setInterestedLaterRestartAt("");
    setInterestedLaterNextAction("");
    setInterestedLaterDecisionOwner("");
  };
  if (!lead) return null;
  const canSave =
    connected === false ||
    (connected === true &&
      outcome !== null &&
      (outcome !== "callback_requested" || Boolean(callbackAt)));

  const save = async () => {
    if (connected === null) return;
    try {
      const result = await logCall(leadId, {
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
                reason: interestedLaterReason.trim() || undefined,
                restartAt: interestedLaterRestartAt || undefined,
                nextAction: interestedLaterNextAction.trim() || undefined,
                decisionOwner: interestedLaterDecisionOwner.trim() || undefined,
              },
            }
          : {}),
        taskId,
      });
      toast.success(connected ? `Call logged - ${label(outcome)}` : "Call logged - Not Connected");
      onOpenChange(false);
      reset();
      if (result?.workflowTrigger) onEnrollPrompt?.(result.workflowTrigger);
      if (result?.promptScheduleMeeting) onScheduleMeetingPrompt?.();
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Log call - {lead.firstName} {lead.lastName}
          </DialogTitle>
          <DialogDescription>
            The backend records the call and applies the resulting lead, task, and automation
            changes atomically.
          </DialogDescription>
        </DialogHeader>
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
                onValueChange={(value) => setReason(value as CallNotConnectedReason)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALL_NOT_CONNECTED_REASONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {label(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                The backend decides contactability, nurture enrollment, and the next action.
              </p>
            </div>
          )}
          {connected === true && (
            <div>
              <Label className="mb-2 block text-xs">Outcome</Label>
              <div className="flex flex-wrap gap-2">
                {CALL_CONNECTED_OUTCOMES.map((value) => (
                  <Choice
                    key={value}
                    active={outcome === value}
                    onClick={() => setOutcome(value)}
                    label={label(value)}
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
                onChange={(event) => setCallbackAt(event.target.value)}
              />
            </div>
          )}
          {outcome === "interested_later" && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Interested - Later details
              </p>
              <div>
                <Label className="mb-1.5 block text-xs">Reason for delay</Label>
                <Input
                  placeholder="e.g. Budget cycle, product launch, internal hiring…"
                  value={interestedLaterReason}
                  onChange={(event) => setInterestedLaterReason(event.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Expected restart date</Label>
                <Input
                  type="date"
                  min={dateInputValue()}
                  value={interestedLaterRestartAt}
                  onChange={(event) => setInterestedLaterRestartAt(event.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Next planned action</Label>
                <Input
                  placeholder="e.g. Reconnect, share case study, management presentation…"
                  value={interestedLaterNextAction}
                  onChange={(event) => setInterestedLaterNextAction(event.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Decision owner</Label>
                <Input
                  placeholder="Person expected to reopen the conversation"
                  value={interestedLaterDecisionOwner}
                  onChange={(event) => setInterestedLaterDecisionOwner(event.target.value)}
                />
              </div>
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave || isPending} onClick={() => void save()}>
            {isPending ? "Saving…" : "Save call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent",
        active && "border-primary bg-primary/10 font-medium text-primary",
      )}
    >
      {text}
    </button>
  );
}
