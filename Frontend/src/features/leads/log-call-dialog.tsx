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
import { addDays, NOW } from "@/lib/dates";
import { useLeads, useSession, useTasks, useTimeline } from "@/store";
import {
  CALL_OUTCOMES,
  NOT_CONNECTED_REASONS,
  type CallOutcome,
  type PipelineStage,
  type TaskType,
} from "@/types";

const OUTCOME_ROUTING: Record<
  CallOutcome,
  {
    stage?: PipelineStage;
    automation?: "Active" | "Manual";
    task?: { type: TaskType; title: string; days: number };
  }
> = {
  Positive: {
    stage: "Meeting Scheduling",
    automation: "Manual",
    task: { type: "Schedule Meeting", title: "Schedule discovery meeting", days: 1 },
  },
  Maybe: {
    stage: "Maybe Nurture",
    automation: "Active",
    task: { type: "Follow-up", title: "Follow up after nurture email", days: 7 },
  },
  Negative: {
    stage: "Negative Nurture",
    automation: "Active",
    task: { type: "Follow-up", title: "Long-term re-engagement check", days: 30 },
  },
  "Callback Requested": {
    automation: "Manual",
    task: { type: "Call", title: "Callback requested by lead", days: 1 },
  },
  "Do Not Contact": {},
};

export function LogCallDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { getLead, updateLead, setAutomation, markDnc } = useLeads();
  const { addTask } = useTasks();
  const { addTimeline } = useTimeline();
  const { currentUser } = useSession();
  const lead = getLead(leadId);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string>(NOT_CONNECTED_REASONS[0]);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState(addDays(1).slice(0, 10));

  const reset = () => {
    setConnected(null);
    setOutcome(null);
    setNotes("");
  };

  if (!lead) return null;

  const canSave = connected === false || (connected === true && outcome !== null);

  const save = () => {
    const now = NOW;

    if (connected === false) {
      addTimeline({
        leadId,
        at: now,
        kind: "call",
        title: "Call Not Connected",
        actor: currentUser.name,
        source: "Manual",
        detail: `${reason}${notes ? ` — ${notes}` : ""}`,
      });
      updateLead(leadId, {
        stage: "Not Connected Nurture",
        nextAction: {
          type: "Call",
          title: "Retry call after nurture touch",
          dueAt: addDays(2),
          ownerId: lead.ownerId,
        },
      });
      setAutomation(leadId, "Active", "Enrolled in Not Connected Nurture");
      toast.success("Call logged — lead enrolled in Not Connected Nurture");
      onOpenChange(false);
      reset();
      return;
    }

    const o = outcome!;
    addTimeline({
      leadId,
      at: now,
      kind: "call",
      title: `Call Connected — ${o}`,
      actor: currentUser.name,
      source: "Manual",
      detail: notes || undefined,
    });

    if (o === "Do Not Contact") {
      markDnc(leadId, notes || "Requested on call");
      toast.success("Lead marked Do Not Contact — automation stopped");
      onOpenChange(false);
      reset();
      return;
    }

    const routing = OUTCOME_ROUTING[o];
    const dueAt =
      o === "Callback Requested" ? `${callbackAt}T10:00:00` : addDays(routing.task?.days ?? 1);

    if (routing.task) {
      addTask({
        leadId,
        ownerId: lead.ownerId,
        type: routing.task.type,
        title: routing.task.title,
        dueAt,
        done: false,
        origin: "Manual",
      });
      updateLead(leadId, {
        ...(routing.stage ? { stage: routing.stage } : {}),
        nextAction: {
          type: routing.task.type,
          title: routing.task.title,
          dueAt,
          ownerId: lead.ownerId,
        },
      });
    }
    if (routing.automation) setAutomation(leadId, routing.automation, `Call outcome: ${o}`);

    toast.success(`Call logged — ${o}`);
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Log call — {lead.firstName} {lead.lastName}
          </DialogTitle>
          <DialogDescription>
            The outcome decides the next stage, the next action and which nurture workflow runs.
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
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOT_CONNECTED_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                The lead moves to Not Connected Nurture and automation takes over the follow-up
                touches.
              </p>
            </div>
          )}

          {connected === true && (
            <div>
              <Label className="mb-2 block text-xs">Outcome</Label>
              <div className="flex flex-wrap gap-2">
                {CALL_OUTCOMES.map((o) => (
                  <Choice key={o} active={outcome === o} onClick={() => setOutcome(o)} label={o} />
                ))}
              </div>
            </div>
          )}

          {outcome === "Callback Requested" && (
            <div>
              <Label className="mb-1.5 block text-xs">Callback date</Label>
              <Input
                type="date"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save}>
            Save call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  label,
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
      {label}
    </button>
  );
}
