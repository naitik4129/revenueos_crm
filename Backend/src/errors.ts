/**
 * Business/HTTP error taxonomy. Routes and services throw these; the error
 * middleware (src/errorMiddleware.ts) maps them to a stable JSON shape the
 * frontend can branch on: { error: { code, message, details? } }.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "invalid_input", message, details);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required or invalid.") {
    super(401, "authentication_failed", message);
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not permitted.") {
    super(403, "forbidden", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, "not_found", `${resource} not found.`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, "conflict", message, details);
    this.name = "ConflictError";
  }
}

/** Lead is under Do Not Contact and the requested action is customer-facing. */
export class DoNotContactError extends AppError {
  constructor(message = "This lead is marked Do Not Contact.") {
    super(409, "do_not_contact", message);
    this.name = "DoNotContactError";
  }
}

/** Requested pipeline/lifecycle/workflow transition is not a valid business transition. */
export class InvalidTransitionError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, "invalid_transition", message, details);
    this.name = "InvalidTransitionError";
  }
}
