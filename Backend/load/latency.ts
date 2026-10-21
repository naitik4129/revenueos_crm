import { createServer, connect, type Server, type Socket } from "node:net";

/**
 * LOAD TEST ONLY. A TCP proxy on 127.0.0.1 that holds every chunk for half the round trip in each
 * direction, so each request/response pair (a Postgres query, an HTTP call) costs `rttMs` more,
 * like a database or auth server in another building. Chunks keep their order: Node runs timers
 * of the same delay first in, first out.
 */
export async function startLatencyProxy(target: { host: string; port: number }, rttMs: number) {
  const up = Math.ceil(rttMs / 2);
  const down = rttMs - up;
  const sockets = new Set<Socket>();
  const pipe = (from: Socket, to: Socket, delay: number) => {
    from.on("data", (chunk) => setTimeout(() => to.writable && to.write(chunk), delay));
    from.on("end", () => setTimeout(() => to.end(), delay));
    from.on("error", () => to.destroy());
    from.on("close", () => setTimeout(() => to.destroy(), delay));
  };
  const server: Server = createServer((client) => {
    const backend = connect(target.port, target.host);
    for (const s of [client, backend]) {
      sockets.add(s);
      s.setNoDelay(true);
      s.on("close", () => sockets.delete(s));
    }
    pipe(client, backend, up);
    pipe(backend, client, down);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Latency proxy has no port.");
  return {
    port: address.port,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
