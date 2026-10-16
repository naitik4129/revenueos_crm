import { useState } from "react";
import { AlertTriangle, Video } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { fmtDateTime, isToday, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { messageFromError, useMeetings, useSession } from "@/store";
import { DealLink } from "@/features/deals/deal-link";
import { ScheduleMeetingDialog } from "./schedule-meeting-dialog";
import {
  MEETING_OUTCOMES,
  MEETING_STATUSES,
  type Meeting,
  type MeetingOutcome,
  type MeetingStatus,
} from "@/types";

export function MeetingsPage() {
  const store = useMeetings();
  const { userName } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sorted = store.meetings.slice().sort((a, b) => a.at.localeCompare(b.at));
  const today = sorted.filter((meeting) => isToday(meeting.at));
  const mutate = async (work: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await work();
      toast.success(success);
    } catch (error) {
      toast.error(messageFromError(error));
    } finally {
      setSaving(false);
    }
  };
  const setStatus = (meeting: Meeting, status: MeetingStatus) =>
    void mutate(() => store.updateMeeting(meeting.id, { status }), `Meeting ${label(status)}`);

  return (
    <div className="pb-10">
      <PageHeader
        title="Meetings"
        description="Every meeting booked from the CRM, with backend-owned outcome routing."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Schedule meeting
          </Button>
        }
      />
      <div className="grid gap-4 p-6 lg:grid-cols-[1fr_300px]">
        {store.isLoading ? (
          <LoadingBlock label="Loading meetings…" />
        ) : store.error ? (
          <ErrorBlock error={store.error} />
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {["Meeting", "Deal", "When", "Owner", "Status", "Outcome", ""].map(
                      (heading) => (
                        <th key={heading} className="px-3 py-2 font-medium">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((meeting) => {
                    return (
                      <tr key={meeting.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2">
                          <div>{meeting.title}</div>
                          {meeting.meetLink && (
                            <a
                              href={meeting.meetLink}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Video className="size-3" /> Join Meet
                            </a>
                          )}
                          {meeting.calendarSyncStatus === "failed" && (
                            <div
                              className="mt-0.5 flex items-center gap-1 text-xs text-destructive"
                              title={meeting.calendarSyncError}
                            >
                              <AlertTriangle className="size-3" /> Calendar sync failed
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <DealLink dealId={meeting.dealId} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {fmtDateTime(meeting.at)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {meeting.ownerName ?? userName(meeting.ownerId)}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={meeting.status}
                            disabled={meeting.status === "completed" || store.isPending}
                            onValueChange={(value) => setStatus(meeting, value as MeetingStatus)}
                          >
                            <SelectTrigger className="h-8 w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {/* "completed" is deliberately excluded from the pickable list —
                                  it must go through "Record outcome" so an outcome is always
                                  captured. It's only ever shown (disabled) as the current value,
                                  so the trigger still displays "Completed" instead of blank. */}
                              {MEETING_STATUSES.filter((value) => value !== "completed").map(
                                (value) => (
                                  <SelectItem key={value} value={value}>
                                    {label(value)}
                                  </SelectItem>
                                ),
                              )}
                              {meeting.status === "completed" && (
                                <SelectItem value="completed" disabled>
                                  {label("completed")}
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {label(meeting.outcome)}
                        </td>
                        <td className="space-x-1 px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={meeting.status === "completed"}
                            onClick={() => setEditing(meeting)}
                          >
                            Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={
                              meeting.status === "completed" || meeting.status === "cancelled"
                            }
                            onClick={() => setOutcomeFor(meeting.id)}
                          >
                            Record outcome
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {sorted.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        No meetings.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {today.length === 0 && (
              <p className="text-sm text-muted-foreground">No meetings today.</p>
            )}
            {today.map((meeting) => (
              <div key={meeting.id} className="rounded-md border px-3 py-2">
                <div className="text-sm font-medium">{meeting.title}</div>
                <div className="text-xs text-muted-foreground">{relDay(meeting.at)}</div>
                <StatusBadge value={meeting.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <ScheduleMeetingDialog
        open={createOpen || Boolean(editing)}
        meeting={editing}
        isSaving={saving}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
        onSave={(value) =>
          void mutate(
            () =>
              editing
                ? store.updateMeeting(editing.id, { ...value, status: "rescheduled" })
                : store.addMeeting(value),
            editing ? "Meeting rescheduled" : "Meeting scheduled",
          )
        }
      />
      <MeetingOutcomeDialog
        open={Boolean(outcomeFor)}
        onOpenChange={(open) => {
          if (!open) setOutcomeFor(null);
        }}
        onSave={(outcome, notes) => {
          if (!outcomeFor) return;
          void mutate(async () => {
            await store.recordOutcome(outcomeFor, outcome, notes);
            setOutcomeFor(null);
          }, "Outcome recorded");
        }}
      />
    </div>
  );
}

export function MeetingOutcomeDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSave: (outcome: MeetingOutcome, notes: string) => void;
}) {
  const [outcome, setOutcome] = useState<MeetingOutcome>("proposal_required");
  const [notes, setNotes] = useState("");
  const [loadedFor, setLoadedFor] = useState(false);

  // Reset on every open (including Cancel, not just a successful save) —
  // this dialog is always mounted, so without this a pick from a previous
  // meeting (even one that was cancelled, not saved) carries over silently.
  if (open && !loadedFor) {
    setLoadedFor(true);
    setOutcome("proposal_required");
    setNotes("");
  }
  if (!open && loadedFor) setLoadedFor(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record meeting outcome</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Outcome</Label>
            <Select value={outcome} onValueChange={(value) => setOutcome(value as MeetingOutcome)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEETING_OUTCOMES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {label(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(outcome, notes);
              setNotes("");
            }}
          >
            Save outcome
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
