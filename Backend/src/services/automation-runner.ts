import { withTransaction } from "../db.js";
import { renderTemplate } from "../domain/templateRenderer.js";
import { htmlToWhatsAppText } from "../domain/htmlToWhatsAppText.js";
import * as automation from "./automation.service.js";

/**
 * One worker tick: claim due actions, then process each with eligibility re-checked right
 * before it runs. Kept apart from worker.ts (the polling loop) so it can be driven by tests.
 */

export interface RunnerOptions {
  batchSize: number;
  /** Render and log messages instead of sending them; the run advances as if they were sent. */
  dryRun: boolean;
  log?: (message: string) => void;
}

/** Renders the message; until P5 every send is dry-run style (nothing leaves the CRM). */
async function dispatchMessage(ctx: automation.ActionContext, opts: RunnerOptions): Promise<automation.RecordResultInput> {
  if (!ctx.template) throw new Error("No template resolved for a message action that passed eligibility (invariant violation).");
  const rendered = renderTemplate(ctx.template, ctx.render, ctx.meeting ?? undefined);
  if (rendered.unknownTokens.length) {
    opts.log?.(`[worker] Template "${ctx.template.name}" has unknown token(s): ${rendered.unknownTokens.join(", ")} (sent as literal text).`);
  }
  const to = ctx.action.actionType === "send_email" ? ctx.deal.email : ctx.deal.phoneE164;
  const text = ctx.action.actionType === "send_email" ? `${rendered.subject ? `Subject: ${rendered.subject}\n` : ""}${rendered.body}` : htmlToWhatsAppText(rendered.body);
  // shortcut: real Resend/SMTP and Baileys sends come back in P5; until then every send is a dry run.
  opts.log?.(`[worker] DRY RUN ${ctx.action.actionType} to ${to} (deal ${ctx.deal.id}):\n${text}`);
  return { outcome: "success", providerMessageId: "DRY_RUN" };
}

export async function processAction(actionId: string, opts: RunnerOptions): Promise<void> {
  const ctx = await withTransaction((db) => automation.getActionContext(db, actionId));
  if (!ctx.eligibility.ok) {
    const verdict = ctx.eligibility;
    await withTransaction((db) => automation.applyIneligible(db, actionId, verdict));
    return;
  }
  if (ctx.action.actionType !== "send_email" && ctx.action.actionType !== "send_whatsapp") {
    await withTransaction((db) => automation.executeInternalAction(db, actionId));
    return;
  }
  let result: automation.RecordResultInput;
  try {
    result = await dispatchMessage(ctx, opts);
  } catch (err) {
    result = { outcome: "failure", error: err instanceof Error ? err.message : String(err) };
  }
  await withTransaction((db) => automation.recordActionResult(db, actionId, result));
}

/** Returns how many actions were claimed. */
export async function runAutomationTick(opts: RunnerOptions): Promise<number> {
  const ids = await withTransaction((db) => automation.claimDueActionIds(db, opts.batchSize));
  // Each action owns its transactions; processing them side by side keeps one slow action from stalling the rest.
  await Promise.allSettled(
    ids.map((id) => processAction(id, opts).catch((err) => opts.log?.(`[worker] Unexpected error processing action ${id}: ${err instanceof Error ? err.message : err}`))),
  );
  return ids.length;
}
