import { DisconnectReason } from "baileys";

const TERMINAL_REASONS = new Set<number>([
  DisconnectReason.loggedOut,
  DisconnectReason.connectionReplaced,
  DisconnectReason.badSession,
  DisconnectReason.forbidden,
  DisconnectReason.multideviceMismatch,
]);

export function isTerminalDisconnect(code: number | undefined) {
  return code !== undefined && TERMINAL_REASONS.has(code);
}

export function reconnectDelayMs(attempt: number, random = Math.random()) {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt), 300_000);
  return Math.round(base * (0.75 + random * 0.5));
}

export function randomSpacingMs(minSeconds: number, maxSeconds: number, random = Math.random()) {
  return Math.round((minSeconds + random * (maxSeconds - minSeconds)) * 1_000);
}

export function isOutboundRestricted(
  reachout: { isActive?: boolean } | null,
  cap: { capping_status?: string; ote_status?: string } | null,
) {
  return Boolean(reachout?.isActive || cap?.capping_status === "CAPPED" || cap?.ote_status === "EXHAUSTED");
}
