import nodemailer from "nodemailer";
import { loadEmailConnection } from "../services/connections.service.js";
import { PermanentProviderError, ProviderDeferredError } from "./provider-errors.js";

export interface SendEmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: SendEmailAttachment[];
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  providerMessageId: string;
}

interface ResendSendResponse {
  id?: string;
  message?: string;
}

async function sendViaResend(input: SendEmailInput, apiKey: string, senderName: string, senderAddress: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${senderName} <${senderAddress}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as ResendSendResponse;
  if (!response.ok || !data.id) {
    const errorMessage = data.message ?? `Resend send failed with status ${response.status}.`;
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new PermanentProviderError(errorMessage);
    }
    throw new Error(errorMessage);
  }
  return { providerMessageId: data.id };
}

export async function sendEmail(workspaceId: string, input: SendEmailInput, options: { allowDisabled?: boolean } = {}): Promise<SendEmailResult> {
  const { row, secrets } = await loadEmailConnection(workspaceId);
  if (!options.allowDisabled && row.provider && !row.enabled) throw new ProviderDeferredError("Email sending is disabled for this workspace.");

  if (!row.provider) {
    // Legacy env-var fallback: process-wide, not per-workspace, kept only
    // until a workspace saves its own database email config (see
    // context.md's "Production Rollout Notes" — matches the original
    // single-tenant fallback behavior for whichever workspace hasn't
    // configured email yet).
    const apiKey = process.env.RESEND_API_KEY;
    const senderAddress = process.env.SMTP_FROM_ADDRESS;
    const senderName = process.env.SMTP_FROM_NAME ?? "MOTM Technologies";
    if (!apiKey || !senderAddress) throw new ProviderDeferredError("Email connection is not configured.");
    return sendViaResend(input, apiKey, senderName, senderAddress);
  }

  const senderName = row.settings.senderName!;
  const senderAddress = row.settings.senderAddress!;
  if (row.provider === "resend") {
    if (!secrets.resendApiKey) throw new ProviderDeferredError("Resend is not fully configured.");
    return sendViaResend(input, secrets.resendApiKey, senderName, senderAddress);
  }

  if (!row.settings.smtpHost || !row.settings.smtpPort || !secrets.smtpUsername || !secrets.smtpPassword) {
    throw new ProviderDeferredError("SMTP is not fully configured.");
  }
  const implicitTls = row.settings.smtpSecurity === "tls";
  const transporter = nodemailer.createTransport({
    host: row.settings.smtpHost,
    port: row.settings.smtpPort,
    secure: implicitTls,
    requireTLS: !implicitTls,
    auth: { user: secrets.smtpUsername, pass: secrets.smtpPassword },
    tls: { minVersion: "TLSv1.2" },
  });
  try {
    const info = await transporter.sendMail({
      from: { name: senderName, address: senderAddress },
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64") })),
      ...(input.headers ? { headers: input.headers } : {}),
    });
    return { providerMessageId: info.messageId };
  } catch (error) {
    const smtpError = error as Error & { responseCode?: number };
    if (smtpError.responseCode && smtpError.responseCode >= 500) throw new PermanentProviderError(smtpError.message);
    throw error;
  }
}
