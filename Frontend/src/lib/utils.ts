import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Native <select> styled like the Select trigger (kept native where tests and keyboards rely on it). */
export const NATIVE_SELECT =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
