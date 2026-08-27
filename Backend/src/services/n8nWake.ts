import { env } from "../env.js";

/**
 * Best-effort "wake up now" nudge to n8n's Due Action Worker (n8n/01), so a
 * scheduled_action that's due immediately doesn't sit waiting for the next
 * ~1-minute Schedule Trigger poll. This is purely a latency optimization on
 * top of that poll, which remains the actual source of truth (see
 * n8n/README.md §6/§7) — never awaited by callers, and any failure
 * (unconfigured, network error, n8n down) is swallowed here so it can never
 * fail the business operation that triggered it. If N8N_WAKE_WEBHOOK_URL
 * isn't set, this is a no-op — nothing breaks, automation just runs at
 * normal polling latency.
 */
export function wakeAutomationExecutor(): void {
  if (!env.N8N_WAKE_WEBHOOK_URL) return;

  fetch(env.N8N_WAKE_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.N8N_WAKE_WEBHOOK_SECRET ? { "X-Wake-Secret": env.N8N_WAKE_WEBHOOK_SECRET } : {}),
    },
    body: "{}",
  }).catch(() => {
    // Swallowed intentionally — see the doc comment above.
  });
}
