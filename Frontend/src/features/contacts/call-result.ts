import type { LogCallResult } from "@/types";

/** What a logged call did to the contact's deals, for the log-call result panel. */
export function describeDealResult(
  result: LogCallResult,
  dealIdsBefore: string[],
  openDealBefore?: string,
) {
  if (!result.deal) return null;
  if (result.deal.id === openDealBefore) return "Routed to the open deal";
  return dealIdsBefore.includes(result.deal.id)
    ? "Reopened the parked (nurture) deal"
    : "Opened a new deal";
}
