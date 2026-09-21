import { PipelineError } from "../pipeline/pipeline-error";
import { createOpenAiClient } from "./openai-client";
import { createProviderChain } from "./provider-chain";
import type { ProviderChain } from "./provider-chain";
import { createRateLimiter } from "./rate-limiter";

// Which models the pipeline uses, in what order, and how fast it may call them.
//
// Secrets live in the environment; everything else lives here. A base URL and an API key
// belong to a provider, so they are stated once per provider. Rate limits belong to a
// model — providers count quota per model, which is exactly why two Gemini models in a row
// is a useful chain — so they are stated per model.

interface ProviderDefinition {
  baseUrl: string;
  /** Name of the environment variable holding this provider's API key. */
  apiKeyEnv: string;
}

export const PROVIDERS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
  },
} as const satisfies Record<string, ProviderDefinition>;

export type ProviderId = keyof typeof PROVIDERS;

export interface ModelDefinition {
  provider: ProviderId;
  model: string;
  /** Set a little below the provider's published free-tier limit, for headroom. */
  requestsPerMinute: number;
  tokensPerMinute: number;
  /** Only for providers that limit per second rather than per minute. */
  minGapMs?: number;
}

/**
 * Tried in this order. All three were checked live against the same job descriptions and
 * extracted the stated requirements, with must/nice correct and nothing invented.
 *
 * Free-tier limits at the time of writing:
 *   gemini-3.5-flash-lite  15 req/min  250,000 tokens/min    500 req/day
 *   gemini-3.1-flash-lite  15 req/min  250,000 tokens/min    500 req/day
 *   qwen/qwen3.8-27b       30 req/min    8,000 tokens/min  1,000 req/day
 *
 * Gemini's token limit counts input tokens only. The limiter counts input and output for
 * every model, which is stricter than Gemini needs and correct for providers that count both.
 */
export const MODEL_CHAIN: ModelDefinition[] = [
  // Normal operation.
  { provider: "gemini", model: "gemini-3.5-flash-lite", requestsPerMinute: 12, tokensPerMinute: 200_000 },
  // Same key, separate quota: takes over when the model above is rate-limited.
  { provider: "gemini", model: "gemini-3.1-flash-lite", requestsPerMinute: 12, tokensPerMinute: 200_000 },
  // A different company: takes over when Google itself is the problem.
  { provider: "groq", model: "qwen/qwen3.8-27b", requestsPerMinute: 25, tokensPerMinute: 6_000 },
];

// A model with another behind it should hand over quickly; the last one has nowhere to
// hand over to, so it gets every retry.
const ATTEMPTS_WITH_BACKUP = 2;
const ATTEMPTS_LAST_IN_CHAIN = 4;

export interface ChainFromEnv {
  chain: ProviderChain;
  /** Models that will be used, in order. */
  active: string[];
  /** Models left out, with the reason, so a startup log can say so. */
  skipped: { model: string; reason: string }[];
}

export interface ChainFromEnvOptions {
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createChainFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: ChainFromEnvOptions = {},
): ChainFromEnv {
  const skipped: ChainFromEnv["skipped"] = [];
  const usable = MODEL_CHAIN.filter((definition) => {
    const { apiKeyEnv } = PROVIDERS[definition.provider];
    if (env[apiKeyEnv]?.trim()) return true;
    skipped.push({ model: definition.model, reason: `${apiKeyEnv} is not set` });
    return false;
  });

  if (usable.length === 0) {
    const keys = [...new Set(MODEL_CHAIN.map((d) => PROVIDERS[d.provider].apiKeyEnv))].join(" or ");
    throw new PipelineError("LLM_NOT_CONFIGURED", `No model API key found. Set ${keys} (see .env.example).`);
  }

  const clients = usable.map((definition, index) => {
    const provider = PROVIDERS[definition.provider];
    return createOpenAiClient({
      baseUrl: provider.baseUrl,
      apiKey: env[provider.apiKeyEnv]!.trim(),
      model: definition.model,
      maxAttempts: index === usable.length - 1 ? ATTEMPTS_LAST_IN_CHAIN : ATTEMPTS_WITH_BACKUP,
      // One limiter per model, created once here and shared by every kit being generated.
      limiter: createRateLimiter({
        requestsPerMinute: definition.requestsPerMinute,
        tokensPerMinute: definition.tokensPerMinute,
        minGapMs: definition.minGapMs,
        now: options.now,
        sleep: options.sleep,
      }),
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
    });
  });

  return {
    chain: createProviderChain(clients, { now: options.now }),
    active: usable.map((d) => d.model),
    skipped,
  };
}
