import { PipelineError } from "../pipeline/pipeline-error";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import { estimateTokens } from "./rate-limiter";
import type { RateLimiter } from "./rate-limiter";

// One client for every provider that speaks the OpenAI chat-completions format — Mistral,
// Gemini's compatibility endpoint, Groq and others. Plain fetch, no SDK: switching provider
// is a change of base URL, model and key, not of code.

export const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
export const DEFAULT_LLM_MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export interface OpenAiClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Shared by every call to this model, across all kits being generated. */
  limiter: RateLimiter;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ChatCompletion {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | { type?: string; text?: string }[] | null };
  }[];
  usage?: { total_tokens?: number };
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_BACKOFF_MS) : undefined;
}

// Some providers return the message as a list of typed chunks rather than one string.
function contentText(content: NonNullable<NonNullable<ChatCompletion["choices"]>[number]["message"]>["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return "";
}

export function createOpenAiClient(options: OpenAiClientOptions): LlmProvider {
  const { baseUrl, apiKey, model, limiter } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_LLM_MAX_ATTEMPTS;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function complete(request: LlmRequest): Promise<LlmResponse> {
    if (!apiKey) {
      throw new PipelineError("LLM_NOT_CONFIGURED", `No API key configured for ${model}`);
    }
    const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const estimate = estimateTokens(request.system + request.user) + maxOutputTokens;
    let lastProblem = "no attempt made";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const reservation = await limiter.acquire(estimate);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
            temperature: request.temperature ?? 0.2,
            max_tokens: maxOutputTokens,
            response_format: { type: "json_object" },
          }),
        });
      } catch (error) {
        // Timeout or network failure: nothing was counted against us, so release the estimate.
        reservation.settle(0);
        lastProblem = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) await sleep(Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS));
        continue;
      }

      if (response.status === 429) {
        // "Slow down" applies to every caller sharing this model, not just this one.
        const wait = retryAfterMs(response.headers.get("retry-after")) ?? Math.min(BACKOFF_BASE_MS * 2 ** attempt, MAX_BACKOFF_MS);
        limiter.pause(wait);
        lastProblem = "HTTP 429 (rate limited)";
        await response.body?.cancel();
        continue;
      }

      if (response.status >= 500) {
        reservation.settle(0);
        lastProblem = `HTTP ${response.status}`;
        await response.body?.cancel();
        if (attempt < maxAttempts) await sleep(Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS));
        continue;
      }

      if (!response.ok) {
        reservation.settle(0);
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        // A bad key or a malformed request will not get better by asking again.
        const code = response.status === 401 || response.status === 403 ? "LLM_AUTH_FAILED" : "LLM_REQUEST_REJECTED";
        throw new PipelineError(code, `${model} answered HTTP ${response.status}: ${detail}`);
      }

      let body: ChatCompletion;
      try {
        body = (await response.json()) as ChatCompletion;
      } catch {
        // A 200 whose body is not JSON (a proxy error page, a cut connection): try again.
        lastProblem = "HTTP 200 with an unreadable body";
        continue;
      }
      const choice = body.choices?.[0];
      if (body.usage?.total_tokens !== undefined) reservation.settle(body.usage.total_tokens);
      return {
        text: contentText(choice?.message?.content),
        truncated: choice?.finish_reason === "length",
        model,
        totalTokens: body.usage?.total_tokens,
      };
    }

    const rateLimited = lastProblem.includes("429");
    throw new PipelineError(
      rateLimited ? "LLM_RATE_LIMITED" : "LLM_UNAVAILABLE",
      `${model} failed after ${maxAttempts} attempts: ${lastProblem}`,
    );
  }

  return { name: model, complete };
}
