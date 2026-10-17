import { useState } from "react";
import { AlertTriangle, CalendarDays, Video } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  FilterSelect,
  ListEmptyState,
  Pager,
  RecordTable,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { fmtDateTime, fmtTime } from "@/lib/format";
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

const PAGE_SIZE = 50;
const ALL = "all";

// Server filters on India-time days: today, from the start of today (soonest first), before it
// (latest first).
type View = "today" | "upcoming" | "past";
const VIEWS: { id: View; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];
const EMPTY: Record<View, string> = {
  today: "No meetings today.",
  upcoming: "No upcoming meetings.",
  past: "No past meetings.",
};

export function MeetingsPage() {
  const [view, setView] = useState<View>("today");
  const [owner, setOwner] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const store = useMeetings({
    when: view,
    ownerId: owner === ALL ? undefined : owner,
    limit: PAGE_SIZE,
    offset,
  });
  const { users, userName } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const columns: ListColumn<Meeting>[] = [
    {
      id: "deal",
      label: "Deal",
      cell: (m) => (
        <DealLink dealId={m.dealId} contactName={m.contactName} companyName={m.companyName} />
      ),
    },
    {
      id: "when",
      label: "When",
      cell: (m) => (view === "today" ? fmtTime(m.at) : fmtDateTime(m.at)),
    },
    { id: "owner", label: "Owner", cell: (m) => m.ownerName ?? userName(m.ownerId) },
    {
      id: "status",
      label: "Status",
      cell: (m) => (
        <Select
          value={m.status}
          disabled={m.status === "completed" || store.isPending}
          onValueChange={(value) => setStatus(m, value as MeetingStatus)}
        >
          <SelectTrigger className="h-7 w-36 text-xs" aria-label={`Status of ${m.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* "completed" is not pickable: it goes through "Record outcome" so an outcome is
                always captured. It only shows (disabled) as the current value. */}
            {MEETING_STATUSES.filter((value) => value !== "completed").map((value) => (
              <SelectItem key={value} value={value}>
                {label(value)}
              </SelectItem>
            ))}
            {m.status === "completed" && (
              <SelectItem value="completed" disabled>
                {label("completed")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      ),
    },
    { id: "outcome", label: "Outcome", cell: (m) => m.outcome && label(m.outcome) },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Meetings"
        description="Every meeting booked from the CRM. Recording an outcome moves the deal on."
        tabs={
          <ViewTabs
            views={VIEWS}
            active={view}
            onSelect={(id) => {
              setView(id as View);
              setOffset(0);
            }}
          />
        }
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Schedule meeting
          </Button>
        }
      />

      <div className="px-6 py-4">
        <Card className="overflow-hidden p-0">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            <FilterSelect
              label="Owner"
              value={owner}
              onChange={(v) => {
                setOwner(v);
                setOffset(0);
              }}
              options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
            />
            {!store.isLoading && (
              <span className="ml-auto text-xs text-muted-foreground">
                {store.total.toLocaleString()} meeting{store.total === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {store.isLoading ? (
            <LoadingBlock label="Loading meetings…" />
          ) : store.error ? (
            <ErrorBlock error={store.error} />
          ) : store.meetings.length === 0 ? (
            <ListEmptyState
              icon={CalendarDays}
              title={EMPTY[view]}
              text="Meetings are booked on a deal: from the deal page, a call outcome, or here."
            >
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Schedule meeting
              </Button>
            </ListEmptyState>
          ) : (
            <RecordTable
              rows={store.meetings}
              columns={columns}
              nameHeader="Meeting"
              rowLabel={(m) => m.title}
              name={(m) => (
                <div>
                  <div className="font-medium">{m.title}</div>
                  {m.meetLink && (
                    <a
                      href={m.meetLink}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Video className="size-3" /> Join Meet
                    </a>
                  )}
                  {m.calendarSyncStatus === "failed" && (
                    <div
                      className="flex items-center gap-1 text-xs text-destructive"
                      title={m.calendarSyncError}
                    >
                      <AlertTriangle className="size-3" /> Calendar sync failed
                    </div>
                  )}
                </div>
              )}
              actions={(m) => (
                <span className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={m.status === "completed"}
                    onClick={() => setEditing(m)}
                  >
                    Reschedule
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={m.status === "completed" || m.status === "cancelled"}
                    onClick={() => setOutcomeFor(m.id)}
                  >
                    Record outcome
                  </Button>
                </span>
              )}
            />
          )}

          {store.total > 0 && (
            <div className="border-t px-3 py-2">
              <Pager
                offset={offset}
                pageSize={PAGE_SIZE}
                total={store.total}
                onOffset={setOffset}
              />
            </div>
          )}
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
