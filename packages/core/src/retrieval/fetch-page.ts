import { checkUrl } from "./url-guard";
import type { UrlGuardOptions } from "./url-guard";

// The only way the pipeline talks to the open web. Pages are untrusted, so every limit
// lives here once: where we may connect, how long we wait, how much we read, what we accept.

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 1_500_000;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const USER_AGENT =
  "InterviewPrepKit/0.1 (assessment project; respects robots.txt)";

const ACCEPTED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain", // robots.txt
  "application/xml", // sitemaps
  "text/xml",
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 500;
const MAX_RETRY_AFTER_MS = 10_000;

export type FetchFailureCode =
  | "BLOCKED_URL"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "TOO_MANY_REDIRECTS"
  | "UNSUPPORTED_CONTENT_TYPE";

export type FetchPageResult =
  | {
      ok: true;
      /** The URL the body actually came from, after redirects. Resolve links against this. */
      url: string;
      status: number;
      contentType: string;
      body: string;
      /** True when the body hit the size cap and was cut short. */
      truncated: boolean;
      attempts: number;
    }
  | {
      ok: false;
      url: string;
      code: FetchFailureCode;
      message: string;
      status?: number;
      attempts: number;
    };

export interface FetchPageOptions extends UrlGuardOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxAttempts?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type Attempt =
  | Extract<FetchPageResult, { ok: true }>
  | {
      ok: false;
      url: string;
      code: FetchFailureCode;
      message: string;
      status?: number;
      retryable: boolean;
      retryAfterMs?: number;
    };

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/** Reads at most maxBytes, then stops the download instead of buffering the rest. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: "", truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - received;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, room));
      received += room;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder("utf-8").decode(bytes), truncated };
}

async function attemptFetch(
  startUrl: string,
  options: FetchPageOptions,
): Promise<Attempt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  // One deadline for the whole attempt: redirects, headers and body together.
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let current = startUrl;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // Checked on every hop: a public page can redirect to a private address.
      const checked = await checkUrl(current, options);
      if (!checked.ok) {
        return {
          ok: false,
          url: current,
          code: "BLOCKED_URL",
          message: `${checked.code}: ${checked.message}`,
          retryable: false,
        };
      }

      const response = await fetchImpl(checked.url, {
        redirect: "manual",
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          return {
            ok: false,
            url: current,
            code: "HTTP_ERROR",
            status: response.status,
            message: `Redirect (${response.status}) without a Location header`,
            retryable: false,
          };
        }
        current = new URL(location, checked.url).href;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        return {
          ok: false,
          url: current,
          code: "HTTP_ERROR",
          status: response.status,
          message: `HTTP ${response.status}`,
          retryable: RETRYABLE_STATUSES.has(response.status),
          retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
        };
      }

      const contentType = (response.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
        await response.body?.cancel();
        return {
          ok: false,
          url: current,
          code: "UNSUPPORTED_CONTENT_TYPE",
          status: response.status,
          message: `Content type ${contentType || "(none)"} is not fetched`,
          retryable: false,
        };
      }

      const { body, truncated } = await readCapped(
        response,
        options.maxBytes ?? DEFAULT_MAX_BYTES,
      );
      return {
        ok: true,
        url: current,
        status: response.status,
        contentType,
        body,
        truncated,
        attempts: 0,
      };
    }

    return {
      ok: false,
      url: current,
      code: "TOO_MANY_REDIRECTS",
      message: `More than ${maxRedirects} redirects`,
      retryable: false,
    };
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      url: current,
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      message: timedOut
        ? `No complete response within ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`
        : `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }
}

/**
 * Fetches one page. Never throws: a page that cannot be retrieved is a result the caller
 * records and moves past, not an exception that ends the run.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions,
): Promise<FetchPageResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    const result = await attemptFetch(url, options);
    if (result.ok) return { ...result, attempts: attempt };

    const { retryable, retryAfterMs: serverDelay, ...failure } = result;
    if (!retryable || attempt >= maxAttempts) {
      return { ...failure, attempts: attempt };
    }

    // Exponential backoff with jitter, unless the server told us how long to wait.
    const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    await sleep(serverDelay ?? backoff + Math.random() * backoff);
  }
}
