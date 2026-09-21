import type { z } from "zod";
import { PipelineError } from "../pipeline/pipeline-error";
import { extractJson } from "./json";
import type { LlmProvider, LlmRequest } from "./provider";
import type { ProviderChain } from "./provider-chain";

// The pipeline never reads free text from a model. Every call names a schema, and what
// comes back is either an object that satisfies it or a typed failure. This is also the
// last line of defence against injected instructions: whatever a page talked the model
// into, the reply still has to be this shape and nothing else.

const MAX_REASK_OUTPUT_TOKENS = 4_000;
const MAX_QUOTED_REPLY_CHARS = 2_000;
const MAX_PROBLEMS = 8;

export interface JsonRequest<T> extends LlmRequest {
  schema: z.ZodType<T>;
}

export interface JsonResult<T> {
  value: T;
  /** The model that produced it. */
  provider: string;
  usedFallback: boolean;
  /** True when the first reply was unusable and the model was asked again. */
  reasked: boolean;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; problems: string[]; reply: string; truncated: boolean };

async function attempt<T>(provider: LlmProvider, request: LlmRequest, schema: z.ZodType<T>): Promise<Attempt<T>> {
  let reply: { text: string; truncated: boolean };
  try {
    reply = await provider.complete(request);
  } catch (error) {
    // Some providers validate JSON themselves and reject the generation outright.
    if (error instanceof PipelineError && error.code === "LLM_INVALID_JSON") {
      return { ok: false, problems: [error.message], reply: "", truncated: false };
    }
    throw error;
  }

  const extracted = extractJson(reply.text);
  if (!extracted.ok) {
    const problem = reply.truncated ? "The reply was cut off before the JSON was complete" : extracted.error;
    return { ok: false, problems: [problem], reply: reply.text, truncated: reply.truncated };
  }

  const parsed = schema.safeParse(extracted.value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const problems = parsed.error.issues
    .slice(0, MAX_PROBLEMS)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return { ok: false, problems, reply: reply.text, truncated: reply.truncated };
}

/** One model: ask, and if the reply is unusable, ask once more saying exactly what was wrong. */
async function askWithOneReask<T>(provider: LlmProvider, request: JsonRequest<T>): Promise<{ value: T; reasked: boolean }> {
  const { schema, ...llmRequest } = request;

  const first = await attempt(provider, llmRequest, schema);
  if (first.ok) return { value: first.value, reasked: false };

  const correction = [
    llmRequest.user,
    "",
    "Your previous reply could not be used.",
    first.reply ? `<previous_reply>\n${first.reply.slice(0, MAX_QUOTED_REPLY_CHARS)}\n</previous_reply>` : "",
    `<problems>\n${first.problems.map((p) => `- ${p}`).join("\n")}\n</problems>`,
    "Reply again with the corrected JSON only.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const second = await attempt(
    provider,
    {
      ...llmRequest,
      user: correction,
      // A reply that ran out of room needs more room, not the same limit again.
      maxOutputTokens: first.truncated
        ? Math.min(Math.ceil((llmRequest.maxOutputTokens ?? 2_000) * 1.5), MAX_REASK_OUTPUT_TOKENS)
        : llmRequest.maxOutputTokens,
    },
    schema,
  );
  if (second.ok) return { value: second.value, reasked: true };

  // One re-ask only: each costs a call against a free-tier quota, and a model that fails
  // twice with the error spelled out rarely succeeds a third time. A different model might.
  throw new PipelineError(
    "LLM_INVALID_JSON",
    `${provider.name} did not return usable JSON after one re-ask: ${second.problems.join("; ")}`,
  );
}

const isChain = (provider: LlmProvider | ProviderChain): provider is ProviderChain => "run" in provider;

export async function completeJson<T>(provider: LlmProvider | ProviderChain, request: JsonRequest<T>): Promise<JsonResult<T>> {
  if (!isChain(provider)) {
    const result = await askWithOneReask(provider, request);
    return { ...result, provider: provider.name, usedFallback: false };
  }
  // Ask-validate-re-ask moves down the chain as one unit, so a model that cannot produce
  // valid output hands over to the next model rather than ending the step.
  const result = await provider.run((link) => askWithOneReask(link, request));
  return { ...result.value, provider: result.provider, usedFallback: result.usedFallback };
}
