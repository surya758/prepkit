import { PipelineError } from "@prepkit/core";
import { ZodError } from "zod";

// Routes throw; one middleware answers. Express 5 forwards a rejected promise from an async
// handler to the error middleware by itself, so no route needs a wrapper or a try/catch.
//
// Every error leaves the API in the same envelope, with a stable code the interface can
// switch on and a message fit to show a person:
//   { "error": { "code": "KIT_NOT_FOUND", "message": "...", "details": [...] } }

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** An expected failure with an HTTP status. Anything else that reaches the handler is a bug. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = "Sign in to continue") => new AppError(401, "UNAUTHENTICATED", message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

// Pipeline failures keep their code; the status says whose problem it is. 400: the request.
// 502: a provider we depend on answered badly. 503: try again later.
const PIPELINE_STATUS: Record<string, number> = {
  INVALID_INPUT: 400,
  LLM_RATE_LIMITED: 503,
  LLM_UNAVAILABLE: 503,
  LLM_NOT_CONFIGURED: 503,
  LLM_AUTH_FAILED: 502,
  LLM_REQUEST_REJECTED: 502,
  LLM_INVALID_JSON: 502,
  INVALID_KIT: 502,
};

// body-parser marks its errors with a `type`; these are the two a client can cause.
const BODY_PARSER: Record<string, { status: number; code: string; message: string }> = {
  "entity.parse.failed": { status: 400, code: "INVALID_JSON", message: "The request body is not valid JSON" },
  "entity.too.large": { status: 413, code: "BODY_TOO_LARGE", message: "The request body is too large" },
};

export interface HttpError {
  status: number;
  body: ErrorBody;
  /** True when this was not an expected failure, so it should be logged as a bug. */
  unexpected: boolean;
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof AppError) {
    const { status, code, message, details } = error;
    return { status, unexpected: false, body: { error: details === undefined ? { code, message } : { code, message, details } } };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      unexpected: false,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are missing or invalid",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      },
    };
  }

  if (error instanceof PipelineError) {
    const status = PIPELINE_STATUS[error.code] ?? 500;
    return { status, unexpected: status === 500, body: { error: { code: error.code, message: error.message } } };
  }

  const parserError = BODY_PARSER[(error as { type?: string } | null)?.type ?? ""];
  if (parserError) {
    const { status, code, message } = parserError;
    return { status, unexpected: false, body: { error: { code, message } } };
  }

  // A bug. The caller gets a fixed sentence: stack traces and internal messages stay in the logs.
  return {
    status: 500,
    unexpected: true,
    body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." } },
  };
}
