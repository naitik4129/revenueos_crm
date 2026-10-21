import { withTransaction } from "../db.js";
import { renderTemplate } from "../domain/templateRenderer.js";
import { htmlToWhatsAppText } from "../domain/htmlToWhatsAppText.js";
import { sendEmail } from "../providers/email.provider.js";
import { sendWhatsApp } from "../providers/whatsapp.provider.js";
import { PermanentProviderError, ProviderDeferredError } from "../providers/provider-errors.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import * as automation from "./automation.service.js";
import { checkSendPolicy } from "./send-policy.service.js";
import { domainHasMx, markEmailInvalid, recordEmailSend, unsubscribeUrl, withUnsubscribe } from "./email-safety.service.js";
import { whatsappNotEngagedReason } from "./whatsapp-safety.service.js";
import { TEMPLATE_ATTACHMENTS_BUCKET } from "./workflows.service.js";
import { claimQueuedProposalWhatsappSends, processQueuedProposalWhatsappSend } from "./proposalSending.service.js";
import { claimQueuedMeetingWhatsappSends, processQueuedMeetingWhatsappSend } from "./meetingScheduledNotification.service.js";

/**
 * One worker tick: claim due workflow actions and process each with eligibility re-checked right
 * before it runs, then drain queued proposal/meeting WhatsApp sends. Kept apart from worker.ts
 * (the polling loop) so tests can drive it.
 */

export interface RunnerOptions {
  batchSize: number;
  /** Render and log messages instead of sending them; the run advances as if they were sent. */
  dryRun: boolean;
  log?: (message: string) => void;
}

type SendResult = automation.RecordResultInput | { blocked: string };

async function dispatchMessage(ctx: automation.ActionContext, opts: RunnerOptions): Promise<SendResult> {
  if (!ctx.template) throw new Error("No template resolved for a message action that passed eligibility (invariant violation).");
  const isEmail = ctx.action.actionType === "send_email";
  const rendered = renderTemplate(ctx.template, ctx.render, ctx.meeting ?? undefined);
  if (rendered.unknownTokens.length) {
    opts.log?.(`[worker] Template "${ctx.template.name}" has unknown token(s): ${rendered.unknownTokens.join(", ")} (sent as literal text).`);
  }

  if (opts.dryRun) {
    const text = isEmail ? `${rendered.subject ? `Subject: ${rendered.subject}\n` : ""}${rendered.body}` : htmlToWhatsAppText(rendered.body);
    opts.log?.(`[worker] DRY RUN ${ctx.action.actionType} to ${isEmail ? ctx.deal.email : ctx.deal.phoneE164} (deal ${ctx.deal.id}):\n${text}`);
    return { outcome: "success", providerMessageId: "DRY_RUN" };
  }

  let unsubscribe: string | null = null;
  if (isEmail) {
    unsubscribe = unsubscribeUrl(ctx.deal.contactId);
    if (!unsubscribe) return { outcome: "deferred", error: "PUBLIC_API_URL is not set: nurture emails need an unsubscribe link.", retryAt: new Date(Date.now() + 60 * 60_000) };
    if (!(await domainHasMx(ctx.deal.email!))) {
      const reason = `No mail server (MX) for ${ctx.deal.email!.split("@").pop()}.`;
      await withTransaction((db) => markEmailInvalid(db, ctx.deal.contactId, reason));
      return { blocked: reason };
    }
  } else {
    // Never cold on WhatsApp: only a contact who replied, had a connected call or opted in.
    const cold = await withTransaction((db) => whatsappNotEngagedReason(db, ctx.deal.contactId));
    if (cold) return { blocked: cold };
  }

  // Sending policy (pause, hours, cap/ramp, gap) and consent once more, immediately before the provider call.
  const verdict = await withTransaction((db) =>
    checkSendPolicy(db, { workspaceId: ctx.workspaceId, channel: isEmail ? "email" : "whatsapp", contactId: ctx.deal.contactId }),
  );
  if (!verdict.ok && verdict.kind === "skip") return { blocked: verdict.reason };
  if (!verdict.ok) {
    opts.log?.(`[worker] Deferred action ${ctx.action.id} until ${verdict.retryAt.toISOString()}: ${verdict.reason}`);
    return { outcome: "deferred", error: verdict.reason, retryAt: verdict.retryAt };
  }

  if (isEmail) {
    const attachments = await Promise.all(
      ctx.template.attachments.map(async (a) => {
        const { data, error } = await supabaseAdmin.storage.from(TEMPLATE_ATTACHMENTS_BUCKET).download(a.storagePath);
        if (error || !data) throw new Error(`Failed to download email attachment "${a.fileName}": ${error?.message ?? "no data"}`);
        return { filename: a.fileName, content: Buffer.from(await data.arrayBuffer()).toString("base64") };
      }),
    );
    const result = await sendEmail(ctx.workspaceId, {
      to: ctx.deal.email!,
      subject: rendered.subject?.trim() || ctx.template.name,
      ...withUnsubscribe(rendered.body, unsubscribe!),
      ...(attachments.length ? { attachments } : {}),
    });
    // So a later bounce or complaint (Resend webhook) finds its workspace and contact.
    await withTransaction((db) =>
      recordEmailSend(db, { workspaceId: ctx.workspaceId, contactId: ctx.deal.contactId, scheduledActionId: ctx.action.id, providerMessageId: result.providerMessageId, to: ctx.deal.email! }),
    ).catch((err: unknown) => opts.log?.(`[worker] Could not record email send ${result.providerMessageId}: ${err instanceof Error ? err.message : err}`));
    return { outcome: "success", providerMessageId: result.providerMessageId };
  }

  const attachment = ctx.template.attachments[0];
  const result = await sendWhatsApp(ctx.workspaceId, {
    source: { type: "scheduled_action", id: ctx.action.id },
    to: ctx.deal.phoneE164!,
    body: htmlToWhatsAppText(rendered.body),
    ...(attachment ? { attachment: { storagePath: attachment.storagePath, fileName: attachment.fileName, mimeType: attachment.mimeType, bucket: TEMPLATE_ATTACHMENTS_BUCKET } } : {}),
  });
  return { outcome: "success", providerMessageId: result.providerMessageId };
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

  let result: SendResult;
  try {
    result = await dispatchMessage(ctx, opts);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderDeferredError) result = { outcome: "deferred", error, retryAt: new Date(Date.now() + err.retryAfterMs) };
    else result = { outcome: "failure", error, retryable: !(err instanceof PermanentProviderError) };
    if (!(err instanceof ProviderDeferredError)) opts.log?.(`[worker] Send failed for action ${actionId} (${ctx.action.actionType}): ${error}`);
  }
  if ("blocked" in result) {
    const reason = result.blocked;
    await withTransaction((db) => automation.applyIneligible(db, actionId, { ok: false, kind: "skip", reason }));
    return;
  }
  const outcome = result;
  await withTransaction((db) => automation.recordActionResult(db, actionId, outcome));
}

/** Returns how many items (workflow actions + queued WhatsApp sends) were claimed. */
export async function runAutomationTick(opts: RunnerOptions): Promise<number> {
  const report = (label: string) => (err: unknown) => opts.log?.(`[worker] Unexpected error processing ${label}: ${err instanceof Error ? err.message : err}`);

  const ids = await withTransaction((db) => automation.claimDueActionIds(db, opts.batchSize));
  // Each item owns its transactions; processing side by side keeps one slow send from stalling the rest.
  await Promise.allSettled(ids.map((id) => processAction(id, opts).catch(report(`action ${id}`))));

  // Proposal and meeting WhatsApp sends (human-triggered) are queued by the API and sent here.
  const proposals = await withTransaction((db) => claimQueuedProposalWhatsappSends(db, opts.batchSize));
  await Promise.allSettled(proposals.map((row) => processQueuedProposalWhatsappSend(row).catch(report(`proposal WhatsApp ${row.id}`))));
  const meetings = await withTransaction((db) => claimQueuedMeetingWhatsappSends(db, opts.batchSize));
  await Promise.allSettled(meetings.map((row) => processQueuedMeetingWhatsappSend(row).catch(report(`meeting WhatsApp ${row.id}`))));

  return ids.length + proposals.length + meetings.length;
}
