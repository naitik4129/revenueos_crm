import { workerEnv as env } from "../workerEnv.js";

/**
 * Real outbound email send for send_email workflow steps (see
 * src/worker.ts), via Resend's HTTP API. Deliberately not SMTP: raw SMTP
 * ports (25/465/587) are unreliably blocked or silently dropped on cloud
 * host egress networks (observed both with Gmail and with Resend's own SMTP
 * relay from Railway), while the HTTP API is a plain HTTPS POST on 443,
 * which is never blocked.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  providerMessageId: string;
}

interface ResendSendResponse {
  id?: string;
  message?: string;
  name?: string;
}

/** Throws on failure — the caller (src/worker.ts) catches this and reports it via recordActionResult's failure/retry path. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_ADDRESS}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as ResendSendResponse;
  if (!response.ok || !data.id) {
    throw new Error(data.message ?? `Resend send failed with status ${response.status}.`);
  }
  return { providerMessageId: data.id };
}
