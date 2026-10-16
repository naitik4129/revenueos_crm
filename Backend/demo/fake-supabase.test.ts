/** The real supabase-js client (same version as the frontend) works against the demo fake. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DEMO_PASSWORD, startFakeSupabase } from "./fake-supabase.js";

describe("fake Supabase (demo mode)", () => {
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "sam@demo.local" };
  let fake: Awaited<ReturnType<typeof startFakeSupabase>>;

  beforeAll(async () => {
    fake = await startFakeSupabase([user]);
  });
  afterAll(() => fake.stop());

  it("signs in, keeps and refreshes a session, and the server verifies the token", async () => {
    const browser = createClient(fake.url, "demo", { auth: { persistSession: true, autoRefreshToken: false } });
    const server = createClient(fake.url, "demo", { auth: { persistSession: false, autoRefreshToken: false } });

    expect((await browser.auth.signInWithPassword({ email: user.email, password: "wrong" })).error?.message).toMatch(/Invalid login/);
    const { data, error } = await browser.auth.signInWithPassword({ email: user.email, password: DEMO_PASSWORD });
    expect(error).toBeNull();
    const token = data.session!.access_token;
    expect((await browser.auth.getSession()).data.session?.user.id).toBe(user.id);

    const verified = await server.auth.getUser(token);
    expect(verified.error).toBeNull();
    expect(verified.data.user?.id).toBe(user.id);
    expect((await server.auth.getUser("not-a-token")).error).not.toBeNull();

    const refreshed = await browser.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.user.id).toBe(user.id);
    await browser.auth.signOut();
    expect((await browser.auth.getSession()).data.session).toBeNull();
  });

  it("stores, signs, downloads and removes files", async () => {
    const server = createClient(fake.url, "demo", { auth: { persistSession: false } });
    const bucket = server.storage.from("crm-proposal-documents");
    expect((await bucket.upload("w/p/doc.pdf", Buffer.from("%PDF demo"), { contentType: "application/pdf" })).error).toBeNull();
    const downloaded = await bucket.download("w/p/doc.pdf");
    expect(await downloaded.data?.text()).toBe("%PDF demo");
    expect((await bucket.createSignedUrl("w/p/doc.pdf", 60)).data?.signedUrl).toContain(fake.url);
    await bucket.remove(["w/p/doc.pdf"]);
    expect((await bucket.download("w/p/doc.pdf")).error).not.toBeNull();
  });

  it("refuses anything else, such as creating real accounts", async () => {
    const server = createClient(fake.url, "demo", { auth: { persistSession: false } });
    const { error } = await server.auth.admin.createUser({ email: "new@x.com", password: "x" });
    expect(error?.message).toMatch(/Not available in demo mode/);
  });
});
