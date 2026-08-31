export class ProviderDeferredError extends Error {
  constructor(message: string, readonly retryAfterMs = 60_000) {
    super(message);
    this.name = "ProviderDeferredError";
  }
}

export class PermanentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentProviderError";
  }
}
