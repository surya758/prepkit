import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";

// A scripted model. Tests of everything above the HTTP client use this, so they need no
// key, no network and no quota, and they are deterministic.

/** A string is sent as-is, an object is sent as JSON, an Error is thrown. */
export type FakeReply = string | Error | { text: string; truncated: boolean } | Record<string, unknown> | unknown[];

export type FakeScript = FakeReply[] | ((request: LlmRequest, callIndex: number) => FakeReply);

export interface FakeProvider extends LlmProvider {
  /** Every request received, in order, so tests can assert on the prompts. */
  calls: LlmRequest[];
}

const isFullReply = (reply: FakeReply): reply is { text: string; truncated: boolean } =>
  typeof reply === "object" && reply !== null && !Array.isArray(reply) && "text" in reply && "truncated" in reply;

export function createFakeProvider(script: FakeScript, name = "fake-model"): FakeProvider {
  const calls: LlmRequest[] = [];

  async function complete(request: LlmRequest): Promise<LlmResponse> {
    const index = calls.length;
    calls.push(request);

    const reply = typeof script === "function" ? script(request, index) : script[index];
    if (reply === undefined) {
      throw new Error(`${name} was called ${index + 1} times but only ${(script as FakeReply[]).length} replies were scripted`);
    }
    if (reply instanceof Error) throw reply;
    if (isFullReply(reply)) return { ...reply, model: name };
    return { text: typeof reply === "string" ? reply : JSON.stringify(reply), truncated: false, model: name };
  }

  return { name, calls, complete };
}
