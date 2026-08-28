import { workerEnv as env } from "../workerEnv.js";

/**
 * Real outbound WhatsApp send for send_whatsapp workflow steps (see
 * src/worker.ts), via the Meta WhatsApp Cloud API's text message endpoint.
 */

export interface SendWhatsAppInput {
  to: string;
  body: string;
}

export interface SendWhatsAppResult {
  providerMessageId: string;
}

interface MetaSendResponse {
  messages?: { id: string }[];
  error?: { message?: string };
}

/**
 * Meta's Cloud API expects the recipient as digits only (country code + number,
 * no leading '+', spaces, or punctuation) — leads.phone may be stored as
 * "+91 98765 43210" or similar, which the API silently rejects or misroutes.
 */
function normalizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/** Throws on failure — the caller (src/worker.ts) catches this and reports it via recordActionResult's failure/retry path. */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const url = `https://graph.facebook.com/${env.META_WHATSAPP_API_VERSION}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhoneForWhatsApp(input.to),
      type: "text",
      text: { body: input.body },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as MetaSendResponse;
  if (!response.ok || !data.messages?.[0]) {
    throw new Error(data.error?.message ?? `WhatsApp send failed with status ${response.status}.`);
  }
  return { providerMessageId: data.messages[0].id };
}
