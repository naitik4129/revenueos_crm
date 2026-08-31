import { baileysManager, type WhatsAppAttachment } from "./baileys.manager.js";

export function sendWhatsApp(input: { actionId: string; to: string; body: string; attachment?: WhatsAppAttachment }) {
  return baileysManager.sendAction({ actionId: input.actionId, phoneE164: input.to, body: input.body, attachment: input.attachment });
}
