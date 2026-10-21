import { describe, expect, it } from "vitest";
import { loadDbError } from "./guards.js";

describe("loadDbError", () => {
  it("allows only the local crm_load database", () => {
    expect(loadDbError("postgres://postgres:x@127.0.0.1:5432/crm_load", "development")).toBeNull();
    expect(loadDbError("postgresql://postgres:x@localhost/crm_load", undefined)).toBeNull();
  });

  it("refuses anything else", () => {
    expect(loadDbError(undefined, "development")).toMatch(/not set/);
    expect(loadDbError("not a url", "development")).toMatch(/valid URL/);
    expect(loadDbError("mysql://127.0.0.1/crm_load", "development")).toMatch(/postgres/);
    expect(loadDbError("postgres://u:p@db.kiythcbtgvvkxdxwdmok.supabase.co:5432/postgres", "development")).toMatch(/this machine/);
    expect(loadDbError("postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/crm_load", "development")).toMatch(/this machine/);
    expect(loadDbError("postgres://u:p@127.0.0.1:5432/postgres", "development")).toMatch(/crm_load/);
    expect(loadDbError("postgres://u:p@127.0.0.1:5432/crm_load", "production")).toMatch(/production/);
  });
});
