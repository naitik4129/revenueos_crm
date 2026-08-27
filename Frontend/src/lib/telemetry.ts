// Single choke point for reporting caught runtime errors.
//
// React does not rethrow boundary-caught errors to window.onerror in
// production, so anything an error boundary swallows is invisible unless it is
// reported here explicitly. Wire a real provider (Sentry, PostHog, an internal
// endpoint) into `sink` — every boundary and catch site already calls this.

export interface ErrorContext {
  [key: string]: unknown;
}

export interface ErrorReport {
  message: string;
  stack?: string | undefined;
  route?: string | undefined;
  context: ErrorContext;
}

type ErrorSink = (report: ErrorReport) => void;

const consoleSink: ErrorSink = (report) => {
  console.error(`[${report.route ?? "server"}] ${report.message}`, report.context, report.stack);
};

let sink: ErrorSink = consoleSink;

/** Swap the destination for error reports (call once during app bootstrap). */
export function setErrorSink(next: ErrorSink) {
  sink = next;
}

/**
 * Loaders and server functions commonly throw a raw `Response`, whose
 * `String(...)` is the useless "[object Response]" — pull the status and URL
 * out instead so the report stays actionable.
 */
export function describeError(error: unknown): { message: string; stack?: string | undefined } {
  if (error instanceof Response) {
    return { message: `Response ${error.status}${error.url ? ` at ${error.url}` : ""}` };
  }
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function reportError(error: unknown, context: ErrorContext = {}) {
  const { message, stack } = describeError(error);
  sink({
    message,
    stack,
    route: typeof window === "undefined" ? undefined : window.location.pathname,
    context,
  });
}
