/**
 * DEMO MODE ONLY. A tiny stand-in for the Supabase Auth and Storage endpoints the CRM uses,
 * listening on 127.0.0.1. The real supabase-js clients (backend and frontend) talk to it
 * unchanged, so no demo code is needed in Backend/src.
 *
 * Auth: password sign-in, token refresh and "who is this token" for the seeded demo users
 * only (every password is "demo"). Storage: an in-memory object store (upload, download,
 * remove, signed URLs). Everything else answers 501.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

export const DEMO_PASSWORD = "demo";
const TOKEN_TTL_SECONDS = 3600;

export interface DemoUser {
  id: string;
  email: string;
}

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned JWT-shaped token (supabase-js reads `exp` and `sub` from it). */
function makeAccessToken(user: DemoUser) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return {
    token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: user.id, email: user.email, exp, aud: "authenticated", role: "authenticated", session_id: randomUUID() })}.demo`,
    exp,
  };
}

function readToken(token: string | undefined): { sub: string; exp: number } | null {
  try {
    const payload = JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url").toString()) as { sub: string; exp: number };
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeSupabase(users: DemoUser[]) {
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byId = new Map(users.map((u) => [u.id, u]));
  const refreshTokens = new Map<string, string>(); // refresh token -> user id
  const objects = new Map<string, { data: Buffer; contentType: string }>(); // "bucket/path" -> file

  const userJson = (u: DemoUser) => ({
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: new Date(0).toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date().toISOString(),
  });
  const session = (u: DemoUser) => {
    const { token, exp } = makeAccessToken(u);
    const refresh = randomUUID();
    refreshTokens.set(refresh, u.id);
    return { access_token: token, token_type: "bearer", expires_in: TOKEN_TTL_SECONDS, expires_at: exp, refresh_token: refresh, user: userJson(u) };
  };

  const send = (res: ServerResponse, status: number, payload?: unknown, contentType = "application/json") => {
    res.writeHead(status, { "content-type": contentType });
    res.end(payload === undefined ? undefined : Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
  };
  const authError = (res: ServerResponse, status: number, msg: string) =>
    send(res, status, { code: status, error_code: status === 401 ? "bad_jwt" : "invalid_credentials", msg, message: msg });

  const server = createServer(async (req, res) => {
    // The frontend (another localhost port) calls this from the browser.
    res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
    res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("access-control-expose-headers", "*");
    if (req.method === "OPTIONS") return send(res, 204);

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname);
    try {
      // --- Auth -------------------------------------------------------------------------
      if (req.method === "POST" && path === "/auth/v1/token") {
        const input = JSON.parse((await body(req)).toString() || "{}") as { email?: string; password?: string; refresh_token?: string };
        const grant = url.searchParams.get("grant_type");
        if (grant === "password") {
          const user = byEmail.get(input.email?.toLowerCase() ?? "");
          if (!user || input.password !== DEMO_PASSWORD) return authError(res, 400, "Invalid login credentials");
          return send(res, 200, session(user));
        }
        if (grant === "refresh_token") {
          const user = byId.get(refreshTokens.get(input.refresh_token ?? "") ?? "");
          if (!user) return authError(res, 400, "Invalid Refresh Token");
          refreshTokens.delete(input.refresh_token!);
          return send(res, 200, session(user));
        }
      }
      if (req.method === "GET" && path === "/auth/v1/user") {
        const claims = readToken(req.headers.authorization?.replace(/^Bearer /, ""));
        const user = claims && byId.get(claims.sub);
        return user ? send(res, 200, userJson(user)) : authError(res, 401, "Invalid or expired token");
      }
      if (req.method === "POST" && path === "/auth/v1/logout") return send(res, 204);

      // --- Storage ------------------------------------------------------------------------
      const signed = path.match(/^\/storage\/v1\/object\/sign\/(.+)$/);
      if (signed && req.method === "POST") {
        const input = JSON.parse((await body(req)).toString() || "{}") as { expiresIn?: number };
        return send(res, 200, { signedURL: `/object/sign/${signed[1]}?token=demo&expires=${input.expiresIn ?? 60}` });
      }
      const object = path.match(/^\/storage\/v1\/object\/(?:sign\/|authenticated\/|public\/)?(.+)$/);
      if (object) {
        if (req.method === "POST" || req.method === "PUT") {
          objects.set(object[1]!, { data: await body(req), contentType: req.headers["content-type"] ?? "application/octet-stream" });
          return send(res, 200, { Key: object[1], Id: randomUUID() });
        }
        if (req.method === "GET") {
          const file = objects.get(object[1]!);
          return file ? send(res, 200, file.data, file.contentType) : send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
        }
        if (req.method === "DELETE") {
          // remove([...paths]) sends DELETE /object/{bucket} with {prefixes}.
          const input = JSON.parse((await body(req)).toString() || "{}") as { prefixes?: string[] };
          for (const p of input.prefixes ?? []) objects.delete(`${object[1]}/${p}`);
          return send(res, 200, []);
        }
      }
      return send(res, 501, { msg: `Not available in demo mode: ${req.method} ${path}`, message: `Not available in demo mode: ${req.method} ${path}` });
    } catch (err) {
      return send(res, 500, { msg: String(err), message: String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
