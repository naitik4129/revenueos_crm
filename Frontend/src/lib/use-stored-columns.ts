import { useState } from "react";

/** A per-list choice remembered in this browser only; `valid` drops stale or tampered values. */
function useStored<T>(storageKey: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
      return valid(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage blocked (private window etc.): the choice lasts until reload.
    }
  };
  return [value, save] as const;
}

/** Visible column ids for one list. */
export function useStoredColumns(storageKey: string, defaults: string[]) {
  return useStored(
    storageKey,
    defaults,
    (v): v is string[] => Array.isArray(v) && v.every((c) => typeof c === "string"),
  );
}

/** The list's sort ("key", or "-key" for descending); undefined = the server's default order. */
export function useStoredSort(storageKey: string, keys: string[]) {
  return useStored<string | undefined>(
    storageKey,
    undefined,
    (v): v is string | undefined =>
      typeof v === "string" && keys.includes(v.startsWith("-") ? v.slice(1) : v),
  );
}
