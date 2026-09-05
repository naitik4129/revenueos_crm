import { z } from "zod";

const emailSchema = z.string().email();

export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  return emailSchema.safeParse(value).success ? value : null;
}
