import { useState } from "react";
import { Plus, X } from "lucide-react";
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
import type { PickerOption } from "@/components/common/search-picker";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import type { Meeting } from "@/types";
import { DealPicker } from "@/features/contacts/pickers";

/**
 * Schedule/reschedule-meeting dialog, shared by the Meetings page (with a deal picker) and the
 * deal page (fixed `dealId`, no picker). No owner picker by design: the backend defaults a new
 * meeting's owner to the deal's owner (Backend/src/services/meetings.service.ts).
 */
export function ScheduleMeetingDialog({
  dealId,
  open,
  meeting,
  isSaving,
  onOpenChange,
  onSave,
}: {
  dealId?: string;
  open: boolean;
  meeting: Meeting | null;
  isSaving?: boolean;
  onOpenChange: (value: boolean) => void;
  onSave: (value: {
    dealId: string;
    ownerId?: string | undefined;
    title: string;
    at: string;
    durationMin: number;
    url?: string | undefined;
    participants?: { name?: string | undefined; email: string }[] | undefined;
  }) => void;
}) {
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pickedDeal, setPickedDeal] = useState<PickerOption | null>(null);
  const [title, setTitle] = useState("Discovery call");
  const [date, setDate] = useState(dateInputValue(1));
  const [time, setTime] = useState("11:00");
  const [duration, setDuration] = useState("30");
  const [url, setUrl] = useState("");
  const [participants, setParticipants] = useState<{ name: string; email: string }[]>([]);
  const key = meeting?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setPickedDeal(null);
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
    setParticipants([]);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const effectiveDealId = meeting?.dealId ?? dealId ?? pickedDeal?.id ?? "";
  const addParticipant = () => setParticipants((prev) => [...prev, { name: "", email: "" }]);
  const updateParticipant = (index: number, patch: Partial<{ name: string; email: string }>) =>
    setParticipants((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const removeParticipant = (index: number) =>
    setParticipants((prev) => prev.filter((_, i) => i !== index));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meeting ? "Reschedule meeting" : "Schedule meeting"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!dealId && !meeting && (
            <div>
              <Label className="mb-1.5 block text-xs">Deal</Label>
              <DealPicker value={pickedDeal} onChange={setPickedDeal} />
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
            <p className="mt-1 text-xs text-muted-foreground">
              Only used if Google Calendar isn&apos;t connected - otherwise a Meet link is generated
              automatically.
            </p>
          </div>
          {!meeting && (
            <div>
              <Label className="mb-1.5 block text-xs">Participants (optional)</Label>
              <div className="space-y-2">
                {participants.map((participant, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Name"
                      className="w-28"
                      value={participant.name}
                      onChange={(event) => updateParticipant(index, { name: event.target.value })}
                    />
                    <Input
                      placeholder="email@example.com"
                      type="email"
                      value={participant.email}
                      onChange={(event) => updateParticipant(index, { email: event.target.value })}
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeParticipant(index)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addParticipant}>
                  <Plus className="size-4" /> Add participant
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!effectiveDealId || !title.trim() || isSaving}
            onClick={() => {
              onSave({
                dealId: effectiveDealId,
                title: title.trim(),
                at: toIsoFromIst(date, `${time}:00`),
                durationMin: Number(duration),
                url: url || undefined,
                participants: meeting
                  ? undefined
                  : participants
                      .filter((p) => p.email.trim())
                      .map((p) => ({ name: p.name.trim() || undefined, email: p.email.trim() })),
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
