import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../Supabase/migrations", import.meta.url));

// Stand-ins for what the shared Supabase project already has. Columns match the real
// public.revenueos_* tables (checked 2026-10-16); only the ones the CRM reads.
const SUPABASE_STANDINS = `
  create role anon;
  create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table public.revenueos_profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    full_name text,
    email text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.revenueos_projects (
    id uuid primary key default gen_random_uuid(),
    customer_name text,
    brain_customer_key text,
    archived_at timestamptz,
    created_at timestamptz not null default now()
  );
`;

export interface TestDb {
  /** Connection string for `pg` (Pool/Client). */
  url: string;
  stop(): Promise<void>;
}

/** Fresh in-memory Postgres 17 with Supabase/migrations 000-010 applied, served over TCP. */
export async function startTestDb(): Promise<TestDb> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STANDINS);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  // shortcut: all connections share one PGlite session (an open transaction blocks the
  // others until it ends), so session-level SET leaks between connections. Fine for
  // sequential tests; use a real Postgres if tests ever need concurrent transactions.
  const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 20 });
  await server.start();

  return {
    url: `postgres://postgres:postgres@${server.getServerConn()}/postgres`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
