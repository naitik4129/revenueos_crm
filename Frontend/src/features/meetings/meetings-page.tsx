import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { fmtDateTime, isToday, relDay } from "@/lib/format";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import { label } from "@/lib/labels";
import { messageFromError, useLeads, useMeetings, useSession } from "@/store";
import { MEETING_OUTCOMES, type Meeting, type MeetingOutcome, type MeetingStatus } from "@/types";

export function MeetingsPage() {
  const store = useMeetings();
  const { leads } = useLeads();
  const { userName } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const sorted = store.meetings.slice().sort((a, b) => a.at.localeCompare(b.at));
  const today = sorted.filter((meeting) => isToday(meeting.at));
  const mutate = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast.success(success);
    } catch (error) {
      toast.error(messageFromError(error));
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
                    {["Meeting", "Lead", "When", "Owner", "Status", "Outcome", ""].map(
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
                    const lead = leads.find((item) => item.id === meeting.leadId);
                    return (
                      <tr key={meeting.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2">{meeting.title}</td>
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
                              {["scheduled", "confirmed", "cancelled", "no_show"].map((value) => (
                                <SelectItem key={value} value={value}>
                                  {label(value)}
                                </SelectItem>
                              ))}
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
      <MeetingDialog
        open={createOpen || Boolean(editing)}
        meeting={editing}
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
      <OutcomeDialog
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

function MeetingDialog({
  open,
  meeting,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  meeting: Meeting | null;
  onOpenChange: (value: boolean) => void;
  onSave: (value: {
    leadId: string;
    ownerId?: string | undefined;
    title: string;
    at: string;
    durationMin: number;
    url?: string | undefined;
  }) => void;
}) {
  const { leads } = useLeads();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("Discovery call");
  const [date, setDate] = useState(dateInputValue(1));
  const [time, setTime] = useState("11:00");
  const [duration, setDuration] = useState("30");
  const [url, setUrl] = useState("");
  const key = meeting?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setLeadId(meeting?.leadId ?? leads[0]?.id ?? "");
    setTitle(meeting?.title ?? "Discovery call");
    const at = meeting ? new Date(meeting.at) : null;
    setDate(
      at
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at)
        : dateInputValue(1),
    );
    setTime(
      at
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(at)
        : "11:00",
    );
    setDuration(String(meeting?.durationMin ?? 30));
    setUrl(meeting?.url ?? "");
  }
  if (!open && loadedFor !== null) setLoadedFor(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meeting ? "Reschedule meeting" : "Schedule meeting"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Lead</Label>
            <Select value={leadId} disabled={Boolean(meeting)} onValueChange={setLeadId}>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Date</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Time</Label>
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Minutes</Label>
              <Input
                type="number"
                min={1}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Meeting URL</Label>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!leadId || !title.trim()}
            onClick={() => {
              onSave({
                leadId,
                title: title.trim(),
                at: toIsoFromIst(date, `${time}:00`),
                durationMin: Number(duration),
                url: url || undefined,
              });
              onOpenChange(false);
            }}
          >
            {meeting ? "Reschedule" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeDialog({
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
