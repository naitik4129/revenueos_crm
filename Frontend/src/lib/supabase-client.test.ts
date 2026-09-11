import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

async function loadWithApiBaseUrl(value: string) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("VITE_API_BASE_URL", value);
  return import("./supabase-client");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("backendBaseUrl", () => {
  it.each([
    ["http://localhost:8787", "http://localhost:8787"],
    ["http://localhost:8787/", "http://localhost:8787"],
    ["https://api.example.com/api", "https://api.example.com"],
    ["https://api.example.com/api/", "https://api.example.com"],
    ["https://api.example.com/api/v1", "https://api.example.com"],
    ["https://api.example.com/api/v1/", "https://api.example.com"],
  ])("normalizes %s to %s", async (input, expected) => {
    const { backendBaseUrl } = await loadWithApiBaseUrl(input);
    expect(backendBaseUrl).toBe(expected);
  });
});
