import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

export interface EncryptedValue {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

const KEY_VERSION = 1;
const key = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, "base64");

export function encryptBytes(value: Buffer, aad: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: KEY_VERSION };
}

export function decryptBytes(value: EncryptedValue, aad: string): Buffer {
  if (value.keyVersion !== KEY_VERSION) {
    throw new Error(`Unsupported integration encryption key version ${value.keyVersion}.`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, value.iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(value.tag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}

export function encryptJson(value: unknown, aad: string): EncryptedValue {
  return encryptBytes(Buffer.from(JSON.stringify(value), "utf8"), aad);
}

export function decryptJson<T>(value: EncryptedValue, aad: string): T {
  return JSON.parse(decryptBytes(value, aad).toString("utf8")) as T;
}

export function encryptText(value: string, aad: string): EncryptedValue {
  return encryptBytes(Buffer.from(value, "utf8"), aad);
}

export function decryptText(value: EncryptedValue, aad: string): string {
  return decryptBytes(value, aad).toString("utf8");
}
