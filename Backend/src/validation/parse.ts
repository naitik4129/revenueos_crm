import type { ZodSchema } from "zod";
import { ValidationError } from "../errors.js";

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Request body failed validation.", result.error.flatten());
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new ValidationError("Query parameters failed validation.", result.error.flatten());
  }
  return result.data;
}
