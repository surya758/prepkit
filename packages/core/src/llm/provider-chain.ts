import { PipelineError } from "../pipeline/pipeline-error";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";

// Models in order of preference: try the first, move to the next when it fails. A model
// that has just failed is skipped for a while (a circuit breaker), so a rate-limited
// primary costs its retries once — not again on every one of the next twenty calls.

export const BASE_COOLDOWN_MS = 60_000;
export const MAX_COOLDOWN_MS = 600_000;

// The model itself is unavailable, so asking it again soon is pointless. A bad reply
// (LLM_INVALID_JSON) is not in this list: the model is up, it just answered badly.
const COOLDOWN_CODES = new Set([
  "LLM_RATE_LIMITED",
  "LLM_UNAVAILABLE",
  "LLM_AUTH_FAILED",
  "LLM_REQUEST_REJECTED",
  "LLM_NOT_CONFIGURED",
]);

export interface ChainFailure {
  provider: string;
  code: string;
  message: string;
}

export interface ChainResult<T> {
  value: T;
  /** The model that produced the value. */
  provider: string;
  /** True when it was not the first model in the chain. */
  usedFallback: boolean;
  /** The models that were tried and failed before this one. */
  failures: ChainFailure[];
}

export interface ProviderChain extends LlmProvider {
  /**
   * Runs `task` against each model in turn until one succeeds. Taking a function rather
   * than a request lets a multi-call task — ask, validate, re-ask — move to the next model
   * as a unit.
   */
  run<T>(task: (provider: LlmProvider) => Promise<T>): Promise<ChainResult<T>>;
  providers: string[];
}

export interface ProviderChainOptions {
  now?: () => number;
}

export function createProviderChain(providers: LlmProvider[], options: ProviderChainOptions = {}): ProviderChain {
  if (providers.length === 0) {
    throw new PipelineError("LLM_NOT_CONFIGURED", "No model is configured. Set GEMINI_API_KEY (and optionally GROQ_API_KEY) in .env; see .env.example.");
  }
  const now = options.now ?? Date.now;
  const skipUntil = new Map<string, number>();
  const nextCooldown = new Map<string, number>();

  async function run<T>(task: (provider: LlmProvider) => Promise<T>): Promise<ChainResult<T>> {
    const available = providers.filter((p) => now() >= (skipUntil.get(p.name) ?? 0));
    // Everything is cooling down: waiting helps nobody, so try them all anyway.
    const order = available.length > 0 ? available : providers;
    const failures: ChainFailure[] = [];
    let lastError: PipelineError | undefined;

    for (const provider of order) {
      try {
        const value = await task(provider);
        skipUntil.delete(provider.name);
        nextCooldown.delete(provider.name);
        return { value, provider: provider.name, usedFallback: provider !== providers[0], failures };
      } catch (error) {
        // Only expected failures move down the chain. Anything else is a bug in our code,
        // and a different model would not fix it.
        if (!(error instanceof PipelineError)) throw error;
        lastError = error;
        failures.push({ provider: provider.name, code: error.code, message: error.message });

        if (COOLDOWN_CODES.has(error.code)) {
          const cooldown = nextCooldown.get(provider.name) ?? BASE_COOLDOWN_MS;
          skipUntil.set(provider.name, now() + cooldown);
          nextCooldown.set(provider.name, Math.min(cooldown * 2, MAX_COOLDOWN_MS));
        }
      }
    }

    const tried = failures.map((f) => `${f.provider}: ${f.code}`).join("; ");
    throw new PipelineError(lastError!.code, `Every configured model failed (${tried}). Last error: ${lastError!.message}`, {
      cause: lastError,
    });
  }

  return {
    name: providers.map((p) => p.name).join(" -> "),
    providers: providers.map((p) => p.name),
    run,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      return (await run((provider) => provider.complete(request))).value;
    },
  };
}
