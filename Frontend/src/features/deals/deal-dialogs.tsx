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
import { backend } from "@/lib/backend-client";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import { label } from "@/lib/labels";
import { useCrmMutation, useSession } from "@/store";
import { TASK_TYPES, type Deal, type Task, type TaskType } from "@/types";
import { ErrorNotice } from "@/features/contacts/contact-dialogs";
import { NATIVE_SELECT, cn } from "@/lib/utils";

export type OutcomeAction = "won" | "discard" | "nurture" | "reopen";

const OUTCOME_TEXT: Record<OutcomeAction, { title: string; description: string; confirm: string }> =
  {
    won: {
      title: "Mark deal won",
      description: "The contact becomes a customer. Open tasks are cancelled.",
      confirm: "Mark won",
    },
    nurture: {
      title: "Move deal to nurture",
      description:
        "Parks the deal (not open). You can enroll a nurture workflow afterwards, and reopen it later.",
      confirm: "Move to nurture",
    },
    discard: {
      title: "Discard deal",
      description: "Closes the deal without a sale. Open tasks are cancelled.",
      confirm: "Discard",
    },
    reopen: {
      title: "Reopen deal",
      description:
        "Back to open with automation set to manual. Refused if the contact already has another open deal.",
      confirm: "Reopen",
    },
  };

/** Won / nurture / discard / reopen with an optional reason. Errors (e.g. 409) show in the dialog. */
export function OutcomeDialog({
  deal,
  action,
  onOpenChange,
}: {
  deal: Deal;
  action: OutcomeAction;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const save = useCrmMutation(() =>
    backend.deals.setOutcome(deal.id, action, reason.trim() || undefined),
  );
  const text = OUTCOME_TEXT[action];
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Reason (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <ErrorNotice error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={action === "discard" ? "destructive" : "default"}
            disabled={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.success(
                    text.confirm === "Reopen" ? "Deal reopened" : `${text.confirm}: done`,
                  );
                  onOpenChange(false);
                },
              })
            }
          >
            {save.isPending ? "Saving…" : text.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const istParts = (iso: string) => ({
  date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso)),
  time: new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso)),
});

/**
 * Adds a task to the deal (or, with no deal, to `contactId`), or reschedules/edits `task`.
 * Times are India time.
 */
export function TaskDialog({
  deal,
  contactId,
  task,
  onOpenChange,
}: {
  deal?: Deal | undefined;
  contactId?: string | undefined;
  task?: Task;
  onOpenChange: (open: boolean) => void;
}) {
  const { users } = useSession();
  const due = task ? istParts(task.dueAt) : { date: dateInputValue(1), time: "10:00" };
  const [type, setType] = useState<TaskType>(task?.type ?? "follow_up");
  const [title, setTitle] = useState(task?.title ?? "");
  const [date, setDate] = useState(due.date);
  const [time, setTime] = useState(due.time);
  const [ownerId, setOwnerId] = useState(task?.ownerId ?? deal?.ownerId ?? "");
  const save = useCrmMutation(() => {
    const input = {
      type,
      title: title.trim(),
      dueAt: toIsoFromIst(date, `${time}:00`),
      ...(ownerId ? { ownerId } : {}),
    };
    return task
      ? backend.tasks.update(task.id, input)
      : backend.tasks.create({ ...input, ...(deal ? { dealId: deal.id } : { contactId }) });
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Reschedule task" : "Add task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Type</Label>
            <select
              aria-label="Task type"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
              className={cn(NATIVE_SELECT, "h-9 w-full px-2 text-sm")}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Due date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Owner</Label>
            <select
              aria-label="Task owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className={cn(NATIVE_SELECT, "h-9 w-full px-2 text-sm")}
            >
              <option value="">Me</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <ErrorNotice error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !date || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.success(task ? "Task rescheduled" : "Task added");
                  onOpenChange(false);
                },
              })
            }
          >
            {save.isPending ? "Saving…" : task ? "Save" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
