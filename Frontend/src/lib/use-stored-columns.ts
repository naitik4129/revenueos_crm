import { useState } from "react";

/** Visible column ids for one list, remembered in this browser only. */
export function useStoredColumns(storageKey: string, defaults: string[]) {
  const [columns, setColumns] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
      return Array.isArray(saved) && saved.every((c) => typeof c === "string") ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  const save = (next: string[]) => {
    setColumns(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage blocked (private window etc.): the choice lasts until reload.
    }
  };
  return [columns, save] as const;
}
