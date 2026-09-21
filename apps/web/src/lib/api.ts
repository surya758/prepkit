// The one place the web app talks to the API. Every failure, whatever caused it, leaves here
// as an ApiError with a code the interface can branch on and a message it can show.

export interface FieldProblem {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Validation failures list every field at once: path -> message. */
  get fields(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as FieldProblem[]).map((d) => [d.path, d.message]));
  }
}

export const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, { method = "GET", body, headers, signal }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;

  // A proxy timeout or a sleeping host answers with HTML, not with the API's envelope.
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;

  const envelope = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  if (envelope?.code && envelope.message) throw new ApiError(response.status, envelope.code, envelope.message, envelope.details);
  throw new ApiError(response.status, "SERVER_UNAVAILABLE", "The server is not responding yet. It may be waking up — try again in a moment.");
}
