import { baileysManager } from "./baileys.manager.js";

export function sendWhatsApp(input: { actionId: string; to: string; body: string }) {
  return baileysManager.sendAction({ actionId: input.actionId, phoneE164: input.to, body: input.body });
}
