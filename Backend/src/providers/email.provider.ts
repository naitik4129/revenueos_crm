import nodemailer from "nodemailer";
import { workerEnv as env } from "../workerEnv.js";

/**
 * Real outbound email send for send_email workflow steps (see
 * src/worker.ts). A single shared SMTP transport for the process — nodemailer
 * pools connections internally, so this is safe to call repeatedly from the
 * poll loop.
 */
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  // Without these, an unreachable/misconfigured SMTP host can hang a send
  // indefinitely (OS-level TCP timeouts can run past a minute), stalling
  // whatever in worker.ts is awaiting it.
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  providerMessageId: string;
}

/** Throws on failure — the caller (src/worker.ts) catches this and reports it via recordActionResult's failure/retry path. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const info = await transport.sendMail({
    from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_ADDRESS}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  return { providerMessageId: info.messageId };
}
