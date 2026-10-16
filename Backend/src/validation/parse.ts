import type { ZodSchema } from "zod";
import { NotFoundError, ValidationError } from "../errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route id that is not a uuid cannot exist: 404, same as an id from another workspace. */
export function parseId(value: string | undefined, resource: string): string {
  if (!value || !UUID_RE.test(value)) throw new NotFoundError(resource);
  return value;
}

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

export function parseParams<T>(schema: ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Route parameters failed validation.", result.error.flatten());
  }
  return result.data;
}
