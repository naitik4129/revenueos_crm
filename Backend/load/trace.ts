import pg from "pg";

/**
 * LOAD TEST ONLY. Wraps pg's Client.query (the app's pool uses the same class) to count the
 * statements of each request and keep their text, values and time. Only one traced request runs
 * at a time, so a single "current" bucket is enough; concurrent phases leave tracing off.
 */
export interface TracedStatement {
  text: string;
  values: unknown[] | undefined;
  ms: number;
}

let current: TracedStatement[] | null = null;

export function startTrace() {
  current = [];
}
export function stopTrace(): TracedStatement[] {
  const done = current ?? [];
  current = null;
  return done;
}

type QueryFn = (...args: unknown[]) => unknown;
let installed = false;

export function installTracer() {
  if (installed) return;
  installed = true;
  const proto = pg.Client.prototype as unknown as { query: QueryFn };
  const original = proto.query;
  proto.query = function (this: unknown, ...args: unknown[]) {
    const bucket = current;
    if (!bucket) return original.apply(this, args);
    const first = args[0] as string | { text?: string; values?: unknown[] } | undefined;
    const text = typeof first === "string" ? first : (first?.text ?? "");
    const values = Array.isArray(args[1]) ? (args[1] as unknown[]) : typeof first === "object" ? first?.values : undefined;
    const started = performance.now();
    const done = () => bucket.push({ text, values, ms: performance.now() - started });
    const last = args[args.length - 1];
    if (typeof last === "function") {
      args[args.length - 1] = (...cbArgs: unknown[]) => {
        done();
        return (last as (...a: unknown[]) => unknown)(...cbArgs);
      };
      return original.apply(this, args);
    }
    const result = original.apply(this, args);
    if (result && typeof (result as Promise<unknown>).then === "function") (result as Promise<unknown>).then(done, done);
    return result;
  };
}
