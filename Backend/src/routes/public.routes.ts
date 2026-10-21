import express, { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { env } from "../env.js";
import { handleResendEvent, unsubscribeContact, unsubscribeTarget, verifyResendSignature, type ResendEvent } from "../services/email-safety.service.js";

/**
 * Routes with no user session, mounted in app.ts: the Resend webhook (signature-checked raw
 * body) and the unsubscribe page behind every nurture email's link.
 */

export const resendWebhookRouter = Router();

resendWebhookRouter.post(
  "/",
  express.raw({ type: "*/*", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const secret = env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: { code: "not_configured", message: "RESEND_WEBHOOK_SECRET is not set." } });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const signed = verifyResendSignature(raw, { id: req.header("svix-id"), timestamp: req.header("svix-timestamp"), signature: req.header("svix-signature") }, secret);
    if (!signed) {
      res.status(401).json({ error: { code: "bad_signature", message: "Webhook signature is missing or invalid." } });
      return;
    }
    let event: ResendEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as ResendEvent;
    } catch {
      res.status(400).json({ error: { code: "bad_payload", message: "Body is not JSON." } });
      return;
    }
    res.json({ result: await withTransaction((db) => handleResendEvent(db, event)) });
  }),
);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
  `<title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222}button{font:inherit;padding:.5rem 1rem;cursor:pointer}</style></head>` +
  `<body><h1>${title}</h1>${body}</body></html>`;

export const unsubscribeRouter = Router();

// GET only shows the page (mail scanners open links); unsubscribing takes the POST, which is also
// the RFC 8058 one-click target named by the List-Unsubscribe-Post header.
unsubscribeRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const target = await unsubscribeTarget(pool, String(req.params.token));
    if (!target) {
      res.status(404).type("html").send(page("Link not valid", "<p>This unsubscribe link is not valid.</p>"));
      return;
    }
    if (target.unsubscribed) {
      res.type("html").send(page("You're unsubscribed", `<p>You will not get more emails from ${escapeHtml(target.workspace)}.</p>`));
      return;
    }
    res
      .type("html")
      .send(page("Unsubscribe", `<p>Stop getting emails from ${escapeHtml(target.workspace)}?</p><form method="post"><button type="submit">Unsubscribe</button></form>`));
  }),
);

unsubscribeRouter.post(
  "/:token",
  asyncHandler(async (req, res) => {
    const target = await unsubscribeTarget(pool, String(req.params.token));
    if (!target) {
      res.status(404).type("html").send(page("Link not valid", "<p>This unsubscribe link is not valid.</p>"));
      return;
    }
    await withTransaction((db) => unsubscribeContact(db, target.contactId));
    res.type("html").send(page("You're unsubscribed", `<p>You will not get more emails from ${escapeHtml(target.workspace)}.</p>`));
  }),
);
