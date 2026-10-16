import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { isOverdue, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { PIPELINE_STAGES, type Deal, type PipelineStage } from "@/types";
import { DEAL_DRAG_TYPE } from "./board";

/**
 * One open deal on the board. Moves by drag and drop onto another column, or with the stage
 * dropdown (a native select, so it works from the keyboard).
 */
export function DealCard({
  deal,
  stage,
  pending,
  onMove,
}: {
  deal: Deal;
  /** The column it shows in (a pending move may differ from deal.stage). */
  stage: PipelineStage;
  pending: boolean;
  onMove: (stage: PipelineStage) => void;
}) {
  const next = deal.nextAction;
  return (
    <article
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.setData(DEAL_DRAG_TYPE, deal.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      aria-label={`Deal: ${deal.contactName}`}
      className={cn(
        "cursor-grab space-y-1.5 rounded-md border bg-card p-2.5 text-xs shadow-sm active:cursor-grabbing",
        pending && "opacity-60",
        deal.doNotContact && "border-destructive/50",
      )}
    >
      <Link
        to="/deals/$dealId"
        params={{ dealId: deal.id }}
        className="block text-sm font-medium leading-tight hover:underline"
      >
        {deal.contactName}
      </Link>
      {deal.companyName && <div className="text-muted-foreground">{deal.companyName}</div>}
      {deal.doNotContact && <div className="font-medium text-destructive">Do Not Contact</div>}
      <div className={next && isOverdue(next.dueAt) ? "text-destructive" : undefined}>
        {next ? (
          <>
            {next.title} · {relDay(next.dueAt)}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning-foreground">
            <AlertTriangle className="size-3" /> No next action
          </span>
        )}
      </div>
      <div className="flex justify-between gap-2 text-muted-foreground">
        <span className="truncate">{deal.ownerName ?? "Unassigned"}</span>
        <span className="shrink-0">{relDay(deal.lastActivityAt)}</span>
      </div>
      <select
        aria-label={`Stage for ${deal.contactName}`}
        value={stage}
        disabled={pending}
        onChange={(e) => onMove(e.target.value as PipelineStage)}
        className="h-7 w-full rounded border bg-background px-1.5 text-xs"
      >
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>
            {label(s)}
          </option>
        ))}
      </select>
    </article>
  );
}
