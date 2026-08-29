import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import { useLeads } from "@/store";
import type { Meeting } from "@/types";

/**
 * Schedule/reschedule-meeting dialog — shared between the Meetings page (its
 * own "Schedule meeting" button, full lead picker) and the lead detail page
 * (opened with a fixed `leadId`, e.g. automatically after a Positive call
 * outcome — see LogCallDialog's `onScheduleMeetingPrompt`). When `leadId` is
 * given, the Lead field is skipped entirely since it's already implied by
 * context, same as EnrollWorkflowDialog never shows one either. No owner
 * picker here by design: the backend already defaults a new meeting's owner
 * to the lead's current owner when none is supplied
 * (Backend/src/services/meetings.service.ts).
 */
export function ScheduleMeetingDialog({
  leadId,
  open,
  meeting,
  onOpenChange,
  onSave,
}: {
  leadId?: string;
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
  const [pickedLeadId, setPickedLeadId] = useState("");
  const [title, setTitle] = useState("Discovery call");
  const [date, setDate] = useState(dateInputValue(1));
  const [time, setTime] = useState("11:00");
  const [duration, setDuration] = useState("30");
  const [url, setUrl] = useState("");
  const key = meeting?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setPickedLeadId(meeting?.leadId ?? leadId ?? leads[0]?.id ?? "");
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

  const effectiveLeadId = leadId ?? pickedLeadId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meeting ? "Reschedule meeting" : "Schedule meeting"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!leadId && (
            <div>
              <Label className="mb-1.5 block text-xs">Lead</Label>
              <Select
                value={pickedLeadId}
                disabled={Boolean(meeting)}
                onValueChange={setPickedLeadId}
              >
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
          )}
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
            disabled={!effectiveLeadId || !title.trim()}
            onClick={() => {
              onSave({
                leadId: effectiveLeadId,
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
