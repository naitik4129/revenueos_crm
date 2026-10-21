import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ContactBulkResult } from "@/lib/backend-client";
import { label } from "@/lib/labels";
import { LIFECYCLE_STAGES, type LifecycleStage } from "@/types";
import { ErrorNotice, Shell } from "./contact-dialogs";
import type { useContactBulk } from "./use-contact-bulk";

const plural = (n: number) => `${n} contact${n === 1 ? "" : "s"}`;

type Mode = "lifecycle" | "dnc" | "lift" | "delete";

/** The contacts list's extra bulk actions, shown in the bulk bar next to Assign owner and Export. */
export function ContactBulkActions({
  bulk,
  count,
  isAdmin,
}: {
  bulk: ReturnType<typeof useContactBulk>;
  count: number;
  isAdmin: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const open = (m: Mode) => {
    bulk.reset();
    setMode(m);
  };
  const dialog = { onOpenChange: (o: boolean) => !o && setMode(null), bulk, count };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => open("lifecycle")}>
        Lifecycle
      </Button>
      <Button size="sm" variant="outline" onClick={() => open("dnc")}>
        Do Not Contact
      </Button>
      {isAdmin && (
        <>
          <Button size="sm" variant="outline" onClick={() => open("lift")}>
            Lift DNC
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => open("delete")}
          >
            Delete
          </Button>
        </>
      )}
      {mode === "lifecycle" && <LifecycleBulk {...dialog} isAdmin={isAdmin} />}
      {(mode === "dnc" || mode === "lift") && <DncBulk {...dialog} lift={mode === "lift"} />}
      {mode === "delete" && <DeleteBulk {...dialog} />}
    </>
  );
}

type DialogProps = {
  onOpenChange: (open: boolean) => void;
  bulk: ReturnType<typeof useContactBulk>;
  count: number;
};
const close = (p: DialogProps) => () => p.onOpenChange(false);

function LifecycleBulk(props: DialogProps & { isAdmin: boolean }) {
  const { bulk, count, isAdmin } = props;
  const [stage, setStage] = useState<LifecycleStage | "">("");
  const [note, setNote] = useState("");
  return (
    <Shell
      open
      onOpenChange={props.onOpenChange}
      title={`Set lifecycle stage on ${plural(count)}`}
      description={
        isAdmin
          ? "Moving a contact back needs a note; it goes on each contact's timeline."
          : "Stages only move forward; contacts already further along are skipped."
      }
      confirm="Set stage"
      disabled={!stage}
      pending={bulk.pending}
      onConfirm={() =>
        stage &&
        bulk.run({ action: "lifecycle", stage, note: note.trim() || undefined }, close(props))
      }
    >
      <ErrorNotice error={bulk.error} />
      <Label>Stage</Label>
      <Select value={stage} onValueChange={(v) => setStage(v as LifecycleStage)}>
        <SelectTrigger aria-label="Stage">
          <SelectValue placeholder="Choose a stage" />
        </SelectTrigger>
        <SelectContent>
          {LIFECYCLE_STAGES.map((s) => (
            <SelectItem key={s} value={s}>
              {label(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isAdmin && (
        <>
          <Label htmlFor="bulk-note">Note (needed to move back)</Label>
          <Textarea
            id="bulk-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
    </Shell>
  );
}

function DncBulk(props: DialogProps & { lift: boolean }) {
  const { bulk, count, lift } = props;
  const [reason, setReason] = useState("");
  return (
    <Shell
      open
      onOpenChange={props.onOpenChange}
      title={
        lift ? `Lift Do Not Contact on ${plural(count)}` : `Mark ${plural(count)} Do Not Contact`
      }
      description={
        lift
          ? "Automation does not restart; deals stay stopped until someone restarts them."
          : "Stops automation and every send; open deals stay open and their open tasks are cancelled."
      }
      confirm={lift ? "Lift Do Not Contact" : "Mark Do Not Contact"}
      destructive={!lift}
      disabled={!reason.trim()}
      pending={bulk.pending}
      onConfirm={() =>
        bulk.run({ action: "dnc", reason: reason.trim(), lift: lift || undefined }, close(props))
      }
    >
      <ErrorNotice error={bulk.error} />
      <Label htmlFor="bulk-reason">Reason</Label>
      <Textarea
        id="bulk-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Shell>
  );
}

function DeleteBulk(props: DialogProps) {
  const { bulk, count } = props;
  const [typed, setTyped] = useState("");
  const [force, setForce] = useState(false);
  return (
    <Shell
      open
      onOpenChange={props.onOpenChange}
      title={`Delete ${plural(count)}`}
      description="Permanent: their deals, activity and timeline go too. A snapshot of each is kept in the audit log."
      confirm="Delete"
      destructive
      disabled={typed.trim() !== String(count)}
      pending={bulk.pending}
      onConfirm={() =>
        bulk.run({ action: "delete", confirm: count, force: force || undefined }, close(props))
      }
    >
      <ErrorNotice error={bulk.error} />
      <Label htmlFor="bulk-confirm">Type {count} to confirm</Label>
      <Input
        id="bulk-confirm"
        inputMode="numeric"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} />
        Also delete contacts that have an open deal (skipped otherwise)
      </label>
    </Shell>
  );
}

export function BulkResultDialog({
  result,
  names,
  onClose,
}: {
  result: ContactBulkResult;
  names: Map<string, string>;
  onClose: () => void;
}) {
  const skipped = result.results.filter((r) => r.status === "skipped");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {result.counts.ok} updated, {result.counts.skipped} skipped
          </DialogTitle>
          <DialogDescription>These contacts were left as they were:</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-72 rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {skipped.map((r) => (
                <tr key={r.id} className="border-t first:border-t-0">
                  <td className="px-3 py-1.5 font-medium">{names.get(r.id) ?? r.id}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
