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
import { fmtDateTime, isToday, relDay } from "@/lib/format";
import { addDays } from "@/lib/dates";
import { useLeads, useMeetings, useSession } from "@/store";
import { MEETING_OUTCOMES, type MeetingOutcome } from "@/types";

export function MeetingsPage() {
  const { meetings, addMeeting, updateMeeting } = useMeetings();
  const { leads, updateLead } = useLeads();
  const { userName, currentUser } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);

  const sorted = meetings.slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  const today = sorted.filter((m) => isToday(m.at));

  return (
    <div className="pb-10">
      <PageHeader
        title="Meetings"
        description="Every meeting booked from the CRM, with the outcome that drives the next stage."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Schedule meeting
          </Button>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-[1fr_300px]">
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {["Meeting", "Lead", "When", "Owner", "Status", "Outcome", ""].map((h, i) => (
                    <th key={i} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const lead = leads.find((l) => l.id === m.leadId);
                  return (
                    <tr key={m.id} className="border-t hover:bg-accent/40">
                      <td className="px-3 py-2">{m.title}</td>
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
                        {fmtDateTime(m.at)}
                      </td>
                      <td className="px-3 py-2 text-xs">{userName(m.ownerId)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge value={m.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {m.outcome ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setOutcomeFor(m.id)}>
                          Record outcome
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {today.length === 0 && (
              <p className="text-sm text-muted-foreground">No meetings today.</p>
            )}
            {today.map((m) => (
              <div key={m.id} className="rounded-md border px-3 py-2">
                <div className="text-sm font-medium">{m.title}</div>
                <div className="text-xs text-muted-foreground">{relDay(m.at)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <ScheduleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSave={(v) => {
          addMeeting({
            leadId: v.leadId,
            ownerId: currentUser.id,
            title: v.title,
            at: `${v.date}T${v.time}:00`,
            durationMin: Number(v.duration),
            url: "https://meet.northbeam.io/room",
            status: "Scheduled",
          });
          updateLead(v.leadId, {
            stage: "Meeting Scheduled",
            nextAction: {
              type: "Follow-up",
              title: "Prepare for the meeting",
              dueAt: `${v.date}T09:00:00`,
              ownerId: currentUser.id,
            },
          });
          toast.success("Meeting scheduled");
        }}
      />

      <OutcomeDialog
        open={!!outcomeFor}
        onOpenChange={(v) => !v && setOutcomeFor(null)}
        onSave={(outcome, notes) => {
          const m = meetings.find((x) => x.id === outcomeFor);
          if (!m) return;
          updateMeeting(m.id, { status: "Completed", outcome, notes });
          if (outcome === "Proposal Required")
            updateLead(m.leadId, {
              stage: "Proposal Preparation",
              nextAction: {
                type: "Follow-up",
                title: "Prepare and upload proposal",
                dueAt: addDays(2),
                ownerId: m.ownerId,
              },
            });
          if (outcome === "Not Interested")
            updateLead(m.leadId, {
              stage: "Long-Term Nurture",
              nextAction: {
                type: "Follow-up",
                title: "Long-term re-engagement",
                dueAt: addDays(45),
                ownerId: m.ownerId,
              },
            });
          if (outcome === "Follow-up Required" || outcome === "Second Meeting")
            updateLead(m.leadId, {
              stage: "Meeting Scheduling",
              nextAction: {
                type: "Schedule Meeting",
                title:
                  outcome === "Second Meeting"
                    ? "Book the second meeting"
                    : "Follow up after meeting",
                dueAt: addDays(3),
                ownerId: m.ownerId,
              },
            });
          setOutcomeFor(null);
          toast.success("Outcome recorded");
        }}
      />
    </div>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (v: {
    leadId: string;
    title: string;
    date: string;
    time: string;
    duration: string;
  }) => void;
}) {
  const { leads } = useLeads();
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const [title, setTitle] = useState("Discovery call");
  const [date, setDate] = useState(addDays(1).slice(0, 10));
  const [time, setTime] = useState("11:00");
  const [duration, setDuration] = useState("30");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule meeting</DialogTitle>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Minutes</Label>
              <Input value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!leadId || !title.trim()}
            onClick={() => {
              onSave({ leadId, title: title.trim(), date, time, duration });
              onOpenChange(false);
            }}
          >
            Schedule
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
  onOpenChange: (v: boolean) => void;
  onSave: (outcome: MeetingOutcome, notes: string) => void;
}) {
  const [outcome, setOutcome] = useState<MeetingOutcome>("Proposal Required");
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
            <Select value={outcome} onValueChange={(v) => setOutcome(v as MeetingOutcome)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEETING_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
