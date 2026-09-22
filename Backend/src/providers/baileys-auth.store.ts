import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "baileys";
import { pool, withTransaction } from "../db.js";
import { decryptBytes, encryptBytes, type EncryptedValue } from "../security/encryption.js";

interface EncryptedRow {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  key_version: number;
}

function decode<T>(row: EncryptedRow, aad: string): T {
  const json = decryptBytes(
    { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version },
    aad,
  ).toString("utf8");
  return JSON.parse(json, BufferJSON.reviver) as T;
}

function encode(value: unknown, aad: string): EncryptedValue {
  return encryptBytes(Buffer.from(JSON.stringify(value, BufferJSON.replacer), "utf8"), aad);
}

/** One workspace's Baileys credentials/keys — every table here is now keyed by workspace_id (see 015_workspaces.sql), so each workspace's WhatsApp session is fully independent. */
export async function loadBaileysAuthState(workspaceId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const result = await pool.query<EncryptedRow>(
    `select ciphertext, iv, tag, key_version from public.whatsapp_auth_credentials where workspace_id = $1`,
    [workspaceId],
  );
  const creds = result.rows[0]
    ? decode<AuthenticationCreds>(result.rows[0], `whatsapp:auth:creds:${workspaceId}`)
    : initAuthCreds();

  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      if (ids.length === 0) return {};
      const rows = await pool.query<EncryptedRow & { key_id: string }>(
        `select key_id, ciphertext, iv, tag, key_version
           from public.whatsapp_auth_keys
          where workspace_id = $1 and key_type = $2 and key_id = any($3::text[])`,
        [workspaceId, type, ids],
      );
      const values: Partial<Record<string, SignalDataTypeMap[T]>> = {};
      for (const row of rows.rows) {
        let value = decode<SignalDataTypeMap[T]>(row, `whatsapp:auth:key:${workspaceId}:${type}:${row.key_id}`);
        if (type === "app-state-sync-key" && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as never) as unknown as SignalDataTypeMap[T];
        }
        values[row.key_id] = value;
      }
      return values as Record<string, SignalDataTypeMap[T]>;
    },
    async set(data: SignalDataSet) {
      await withTransaction(async (db) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
            if (value == null) {
              await db.query(`delete from public.whatsapp_auth_keys where workspace_id = $1 and key_type = $2 and key_id = $3`, [workspaceId, type, id]);
              continue;
            }
            const encrypted = encode(value, `whatsapp:auth:key:${workspaceId}:${type}:${id}`);
            await db.query(
              `insert into public.whatsapp_auth_keys
                (workspace_id, key_type, key_id, ciphertext, iv, tag, key_version)
               values ($1,$2,$3,$4,$5,$6,$7)
               on conflict (workspace_id, key_type, key_id) do update
                 set ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
                     key_version = excluded.key_version, updated_at = now()`,
              [workspaceId, type, id, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion],
            );
          }
        }
      });
    },
    async clear() {
      await pool.query(`delete from public.whatsapp_auth_keys where workspace_id = $1`, [workspaceId]);
    },
  };

  return {
    state: { creds, keys },
    saveCreds: async () => {
      const encrypted = encode(creds, `whatsapp:auth:creds:${workspaceId}`);
      await pool.query(
        `insert into public.whatsapp_auth_credentials (workspace_id, ciphertext, iv, tag, key_version)
         values ($1,$2,$3,$4,$5)
         on conflict (workspace_id) do update
           set ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
               key_version = excluded.key_version, updated_at = now()`,
        [workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion],
      );
    },
  };
}

export async function clearBaileysAuthState(workspaceId: string) {
  await withTransaction(async (db) => {
    await db.query(`delete from public.whatsapp_auth_keys where workspace_id = $1`, [workspaceId]);
    await db.query(`delete from public.whatsapp_auth_credentials where workspace_id = $1`, [workspaceId]);
  });
}

export const baileysSerialization = { encode, decode };
