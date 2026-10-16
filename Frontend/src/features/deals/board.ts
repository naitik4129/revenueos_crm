import { PIPELINE_STAGES, type Deal, type PipelineStage } from "@/types";

/** Drag payload type, so drops of other things (text, files) are ignored. */
export const DEAL_DRAG_TYPE = "application/x-crm-deal";

/**
 * One column per pipeline stage, in pipeline order. `pending` holds moves sent to the backend
 * but not yet confirmed, so a card shows in its new column at once and goes back if the move
 * fails (the entry is simply removed).
 */
export function groupDealsByStage(deals: Deal[], pending: Partial<Record<string, PipelineStage>>) {
  const columns = new Map<PipelineStage, Deal[]>(PIPELINE_STAGES.map((stage) => [stage, []]));
  for (const deal of deals) columns.get(pending[deal.id] ?? deal.stage)?.push(deal);
  return columns;
}
