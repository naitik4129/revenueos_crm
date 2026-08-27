import { useCallback, useRef } from "react";

export type NextId = (prefix: string) => string;

/**
 * Client-side id generator for optimistically created records.
 *
 * Scoped to the provider rather than the module: a module-level counter is
 * shared by every SSR render in the same process, which leaks ids across
 * requests. Once the backend owns id generation this goes away entirely.
 */
export function useIdFactory(start = 1000): NextId {
  const counter = useRef(start);
  return useCallback((prefix: string) => `${prefix}${++counter.current}`, []);
}
