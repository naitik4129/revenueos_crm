import { PIPELINE_STAGES, type Deal, type PipelineStage } from "@/types";

/** Drag payload type, so drops of other things (text, files) are ignored. */
export const DEAL_DRAG_TYPE = "application/x-crm-deal";

/** Each deal once (a deal can sit in two columns' pages for a moment while they refetch). */
export function uniqueDeals(deals: Deal[]) {
  return [...new Map(deals.map((d) => [d.id, d])).values()];
}

export interface StageHeader {
  count: number;
  amount: number;
}

/**
 * Column headers from the server's summary (every open deal, not just the loaded ones), with
 * the moves still being saved applied: a pending deal counts in its new stage (no amount = 0).
 * Once a move is saved the summary is refetched and already has it, so nothing moves twice.
 */
export function stageHeaders(
  stages: { stage: PipelineStage; count: number; amount: number }[],
  deals: Deal[],
  pending: Partial<Record<string, PipelineStage>>,
) {
  const headers = new Map<PipelineStage, StageHeader>(
    PIPELINE_STAGES.map((stage) => [stage, { count: 0, amount: 0 }]),
  );
  for (const s of stages) headers.set(s.stage, { count: s.count, amount: s.amount });
  for (const deal of deals) {
    const to = pending[deal.id];
    if (!to || to === deal.stage) continue;
    const from = headers.get(deal.stage)!;
    const next = headers.get(to)!;
    headers.set(deal.stage, { count: from.count - 1, amount: from.amount - (deal.amount ?? 0) });
    headers.set(to, { count: next.count + 1, amount: next.amount + (deal.amount ?? 0) });
  }
  return headers;
}
