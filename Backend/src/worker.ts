import { pool, withTransaction } from "./db.js";
import { workerEnv as env } from "./workerEnv.js";
import * as automationService from "./services/automation.service.js";
import { renderTemplate } from "./domain/templateRenderer.js";
import { htmlToWhatsAppText } from "./domain/htmlToWhatsAppText.js";
import { sendEmail } from "./providers/email.provider.js";
import { sendWhatsApp } from "./providers/whatsapp.provider.js";
import type { WorkflowStepAction } from "./domain/enums.js";
import { baileysManager } from "./providers/baileys.manager.js";
import { PermanentProviderError, ProviderDeferredError } from "./providers/provider-errors.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

/**
 * The automation executor: polls for due scheduled_actions and dispatches
 * them. This file is deliberately thin — every business decision
 * (eligibility, retry/backoff, next-step scheduling, timeline logging)
 * already lives in automation.service.ts and is reused as-is; this loop
 * just calls those functions in-process.
 */

const MESSAGE_ACTION_TYPES: WorkflowStepAction[] = ["send_email", "send_whatsapp"];

interface SendOutcome {
  outcome: "success";
  providerMessageId: string;
}

async function dispatchMessage(ctx: automationService.ActionContext): Promise<SendOutcome> {
  if (!ctx.template) {
    throw new Error("No template resolved for a message action that passed eligibility (invariant violation).");
  }

  const rendered = renderTemplate(ctx.template, ctx.lead);
  if (rendered.unknownTokens.length > 0) {
    console.warn(
      `[worker] Template "${ctx.template.name}" (action ${ctx.action.id}) has unrecognized token(s): ${rendered.unknownTokens.join(", ")} — sent as literal text.`,
    );
  }

  if (env.WORKER_DRY_RUN) {
    console.log(
      `[worker] DRY RUN — would send ${ctx.action.actionType} to lead ${ctx.lead.id}:\n${
        rendered.subject ? `Subject: ${rendered.subject}\n` : ""
      }${rendered.body}`,
    );
    return { outcome: "success", providerMessageId: "DRY_RUN" };
  }

  if (ctx.action.actionType === "send_email") {
    if (!ctx.lead.email) throw new Error("Eligible send_email action has no lead email (invariant violation).");
    const subject = rendered.subject?.trim() || ctx.template.name;
    const attachments = await Promise.all(
      ctx.template.attachments.map(async (attachment) => {
        const { data, error } = await supabaseAdmin.storage.from("template-attachments").download(attachment.storagePath);
        if (error || !data) throw new Error(`Failed to download email attachment "${attachment.fileName}": ${error?.message ?? "no data"}`);
        const buffer = Buffer.from(await data.arrayBuffer());
        return { filename: attachment.fileName, content: buffer.toString("base64") };
      }),
    );
    const result = await sendEmail({
      to: ctx.lead.email,
      subject,
      html: rendered.body,
      ...(attachments.length ? { attachments } : {}),
    });
    return { outcome: "success", providerMessageId: result.providerMessageId };
  }

  if (!ctx.lead.phoneE164) throw new PermanentProviderError("Eligible WhatsApp action has no normalized phone number.");
  const whatsappText = htmlToWhatsAppText(rendered.body);
  const attachment = ctx.template.attachments[0];
  const result = await sendWhatsApp({
    actionId: ctx.action.id,
    to: ctx.lead.phoneE164,
    body: whatsappText,
    ...(attachment ? { attachment: { storagePath: attachment.storagePath, fileName: attachment.fileName, mimeType: attachment.mimeType } } : {}),
  });
  return { outcome: "success", providerMessageId: result.providerMessageId };
}

async function processAction(ctx: automationService.ActionContext): Promise<void> {
  if (!ctx.eligibility.ok) {
    await withTransaction((client) => automationService.skipAction(client, ctx.action.id, ctx.eligibility.reason ?? "Not eligible."));
    return;
  }

  if (!MESSAGE_ACTION_TYPES.includes(ctx.action.actionType)) {
    await withTransaction((client) => automationService.executeInternalAction(client, ctx.action.id));
    return;
  }

  try {
    const result = await dispatchMessage(ctx);
    await withTransaction((client) => automationService.recordActionResult(client, ctx.action.id, result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderDeferredError) {
      await withTransaction((client) =>
        automationService.recordActionResult(client, ctx.action.id, {
          outcome: "deferred",
          error: message,
          retryAt: new Date(Date.now() + err.retryAfterMs),
        }),
      );
      return;
    }
    console.error(`[worker] Send failed for action ${ctx.action.id} (${ctx.action.actionType}): ${message}`);
    await withTransaction((client) =>
      automationService.recordActionResult(client, ctx.action.id, {
        outcome: "failure",
        error: message,
        retryable: !(err instanceof PermanentProviderError),
      }),
    );
  }
}

async function tick(): Promise<void> {
  const claimed = await withTransaction((client) => automationService.claimDueActions(client, env.WORKER_BATCH_SIZE));
  if (claimed.length === 0) return;

  console.log(`[worker] Claimed ${claimed.length} due action(s).`);
  // Each claimed action owns its own DB transaction and provider call, with
  // no shared mutable state between them, so processing the batch
  // concurrently is safe — and avoids one slow/hung send stalling the rest
  // of the batch behind it (a real risk now that email.provider.ts has a
  // bounded but non-trivial socket timeout).
  await Promise.allSettled(
    claimed.map((ctx) =>
      processAction(ctx).catch((err) => {
        console.error(`[worker] Unexpected error processing action ${ctx.action.id}:`, err);
      }),
    ),
  );
}

let stopped = false;

async function loop(): Promise<void> {
  while (!stopped) {
    await tick().catch((err) => console.error("[worker] Poll tick failed:", err));
    if (stopped) break;
    await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
  }
}

console.log(
  `Northbeam CRM automation worker starting (poll interval ${env.WORKER_POLL_INTERVAL_MS}ms, batch size ${env.WORKER_BATCH_SIZE}, dry run ${env.WORKER_DRY_RUN}).`,
);
void baileysManager
  .start()
  .then(() => loop())
  .catch(async (error) => {
    console.error("Automation worker failed to acquire or initialize its singleton messaging session:", error);
    await baileysManager.stop().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down worker...`);
  stopped = true;
  try {
    await baileysManager.stop();
    await pool.end();
  } catch (err) {
    console.error("[worker] Error closing database pool during shutdown:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
