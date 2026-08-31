import { baileysManager, type WhatsAppAttachment, type WhatsAppSendSource } from "./baileys.manager.js";

export function sendWhatsApp(input: { source: WhatsAppSendSource; to: string; body: string; attachment?: WhatsAppAttachment }) {
  return baileysManager.sendAction({ source: input.source, phoneE164: input.to, body: input.body, attachment: input.attachment });
}
