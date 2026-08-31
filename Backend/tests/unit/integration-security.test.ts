import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../../src/security/encryption.js";
import { normalizePhoneE164, jidToPhoneE164, phoneE164ToJid } from "../../src/domain/phone.js";
import {
  isOutboundRestricted,
  isTerminalDisconnect,
  randomSpacingMs,
  reconnectDelayMs,
} from "../../src/domain/baileys-policy.js";
import { DisconnectReason } from "baileys";

describe("integration encryption", () => {
  it("round-trips structured values with bound associated data", () => {
    const encrypted = encryptJson({ password: "secret", bytes: [1, 2, 3] }, "test:connection");
    expect(decryptJson(encrypted, "test:connection")).toEqual({ password: "secret", bytes: [1, 2, 3] });
    expect(() => decryptJson(encrypted, "wrong:connection")).toThrow();
  });

  it("rejects modified authentication tags", () => {
    const encrypted = encryptJson({ token: "secret" }, "test:tamper");
    encrypted.tag = Buffer.from(encrypted.tag);
    encrypted.tag[0]! ^= 1;
    expect(() => decryptJson(encrypted, "test:tamper")).toThrow();
  });
});

describe("phone normalization", () => {
  it("defaults valid Indian local numbers to +91", () => {
    expect(normalizePhoneE164("98765 43210")).toBe("+919876543210");
  });

  it("accepts explicit international numbers and rejects ambiguity", () => {
    expect(normalizePhoneE164("+1 415 555 2671")).toBe("+14155552671");
    expect(normalizePhoneE164("12345")).toBeNull();
  });

  it("maps canonical phones and direct-chat JIDs", () => {
    expect(phoneE164ToJid("+919876543210")).toBe("919876543210@s.whatsapp.net");
    expect(jidToPhoneE164("919876543210@s.whatsapp.net")).toBe("+919876543210");
    expect(jidToPhoneE164("123@g.us")).toBeNull();
  });
});

describe("Baileys safety policy", () => {
  it("classifies terminal and transient disconnects", () => {
    expect(isTerminalDisconnect(DisconnectReason.loggedOut)).toBe(true);
    expect(isTerminalDisconnect(DisconnectReason.connectionReplaced)).toBe(true);
    expect(isTerminalDisconnect(DisconnectReason.connectionLost)).toBe(false);
  });

  it("caps reconnect backoff at five minutes before jitter", () => {
    expect(reconnectDelayMs(0, 0.5)).toBe(1_000);
    expect(reconnectDelayMs(20, 0.5)).toBe(300_000);
    expect(reconnectDelayMs(20, 0)).toBe(225_000);
  });

  it("keeps randomized send spacing within configured bounds", () => {
    expect(randomSpacingMs(5, 15, 0)).toBe(5_000);
    expect(randomSpacingMs(5, 15, 1)).toBe(15_000);
  });

  it("halts for reachout and new-chat enforcement", () => {
    expect(isOutboundRestricted({ isActive: true }, null)).toBe(true);
    expect(isOutboundRestricted(null, { capping_status: "CAPPED" })).toBe(true);
    expect(isOutboundRestricted(null, { ote_status: "EXHAUSTED" })).toBe(true);
    expect(isOutboundRestricted(null, null)).toBe(false);
  });
});
