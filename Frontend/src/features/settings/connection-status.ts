import type {
  EmailConnection,
  GoogleCalendarConnection,
  WhatsAppConnection,
} from "@/lib/backend-client";

export type ConnectionState = "connected" | "not_connected" | "pending" | "error";
export interface ConnectionSummary {
  state: ConnectionState;
  text: string;
}

/** Ready to send = a provider with its secrets, and sending switched on. */
export function emailStatus(c: EmailConnection): ConnectionSummary {
  const configured =
    c.provider === "smtp"
      ? Boolean(c.smtpHost) && c.smtpUsernameConfigured && c.smtpPasswordConfigured
      : c.resendApiKeyConfigured || c.environmentFallbackConfigured;
  if (!configured || c.source === "unconfigured")
    return { state: "not_connected", text: "Not set up yet." };
  if (!c.enabled) return { state: "not_connected", text: "Set up, but outbound email is off." };
  return {
    state: "connected",
    text: `Sending as ${c.senderAddress || "the default sender"}${
      c.source === "environment" ? " (environment fallback)" : ""
    }.`,
  };
}

export function whatsappStatus(c: WhatsAppConnection): ConnectionSummary {
  const account = c.displayName || c.connectedPhone;
  if (c.status === "error") return { state: "error", text: c.lastError || "The session failed." };
  if (c.status === "reauth_required")
    return { state: "error", text: "WhatsApp logged this device out. Connect and scan again." };
  if (c.outboundRestricted)
    return { state: "error", text: "WhatsApp restricted new chats; sends are halted." };
  if (c.status === "connected")
    return {
      state: "connected",
      text: `${account ?? "Paired"}${c.enabled ? "" : " · outbound is off"}.`,
    };
  if (c.status === "qr_ready") return { state: "pending", text: "Scan the QR code below." };
  if (c.status === "connecting" || c.status === "reconnecting")
    return { state: "pending", text: "Connecting…" };
  return { state: "not_connected", text: "No phone paired." };
}

export function calendarStatus(c: GoogleCalendarConnection): ConnectionSummary {
  if (c.status === "error")
    return { state: "error", text: c.lastError || "The connection failed." };
  if (c.status === "connected")
    return { state: "connected", text: c.connectedEmail || "Connected." };
  return {
    state: "not_connected",
    text: c.configured ? "Not connected." : "Add OAuth credentials first.",
  };
}
