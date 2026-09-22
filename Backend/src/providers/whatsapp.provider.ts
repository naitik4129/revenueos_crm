import { baileysRegistry } from "./baileys-registry.js";
import type { WhatsAppAttachment, WhatsAppSendSource } from "./baileys.manager.js";

export async function sendWhatsApp(workspaceId: string, input: { source: WhatsAppSendSource; to: string; body: string; attachment?: WhatsAppAttachment }) {
  const manager = await baileysRegistry.getOrCreateManager(workspaceId);
  return manager.sendAction({ source: input.source, phoneE164: input.to, body: input.body, attachment: input.attachment });
}
