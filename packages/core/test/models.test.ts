import { describe, expect, it, vi } from "vitest";
import { MODEL_CHAIN, PROVIDERS, createChainFromEnv } from "../src";

// A fake network that records which model and key each request used.
function network(respond: (model: string) => Response) {
  let time = 0;
  const requests: { url: string; model: string; key: string }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const model = JSON.parse(init!.body as string).model as string;
    const key = (init!.headers as Record<string, string>).authorization!.replace("Bearer ", "");
    requests.push({ url: String(url), model, key });
    return respond(model);
  });
  const options = {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
  return { requests, options };
}

const ok = () =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { total_tokens: 5 } }), {
    status: 200,
  });
const unavailable = () => new Response("", { status: 503 });
const request = { system: "s", user: "u" };

describe("model definitions", () => {
  it("every model names a known provider and has positive limits", () => {
    for (const definition of MODEL_CHAIN) {
      expect(PROVIDERS[definition.provider]).toBeDefined();
      expect(definition.requestsPerMinute).toBeGreaterThan(0);
      expect(definition.tokensPerMinute).toBeGreaterThan(0);
    }
  });

  it("lists each model once", () => {
    const names = MODEL_CHAIN.map((d) => d.model);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("createChainFromEnv — which models are used", () => {
  it("uses all three when both keys are set", () => {
    const { active, skipped } = createChainFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
    expect(active).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "qwen/qwen3.8-27b"]);
    expect(skipped).toEqual([]);
  });

  it("runs on the two Gemini models with only a Gemini key, and says what it left out", () => {
    const { active, skipped } = createChainFromEnv({ GEMINI_API_KEY: "g" });
    expect(active).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    expect(skipped).toEqual([{ model: "qwen/qwen3.8-27b", reason: "GROQ_API_KEY is not set" }]);
  });

  it("still runs with only a Groq key", () => {
    expect(createChainFromEnv({ GROQ_API_KEY: "q" }).active).toEqual(["qwen/qwen3.8-27b"]);
  });

  it("treats a blank key as missing", () => {
    expect(createChainFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "   " }).active).toHaveLength(2);
  });

  it("fails clearly when no key is set at all", () => {
    expect(() => createChainFromEnv({})).toThrowError(
      expect.objectContaining({
        code: "LLM_NOT_CONFIGURED",
        message: "No model API key found. Set GEMINI_API_KEY or GROQ_API_KEY (see .env.example).",
      }),
    );
  });
});

describe("createChainFromEnv — wiring", () => {
  it("sends each model to its own provider's URL with that provider's key", async () => {
    const net = network((model) => (model === "qwen/qwen3.8-27b" ? ok() : unavailable()));
    const { chain } = createChainFromEnv({ GEMINI_API_KEY: "gemini-secret", GROQ_API_KEY: "groq-secret" }, net.options);

    const result = await chain.run((p) => p.complete(request));

    expect(result.provider).toBe("qwen/qwen3.8-27b");
    const last = net.requests.at(-1)!;
    expect(last).toEqual({ url: "https://api.groq.com/openai/v1/chat/completions", model: "qwen/qwen3.8-27b", key: "groq-secret" });
    expect(net.requests[0]).toMatchObject({
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: "gemini-secret",
    });
  });

  it("gives a model with a backup 2 tries and the last model 4", async () => {
    const net = network(unavailable);
    const { chain } = createChainFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }, net.options);

    await expect(chain.run((p) => p.complete(request))).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });

    const tries = (model: string) => net.requests.filter((r) => r.model === model).length;
    expect(tries("gemini-3.5-flash-lite")).toBe(2);
    expect(tries("gemini-3.1-flash-lite")).toBe(2);
    expect(tries("qwen/qwen3.8-27b")).toBe(4);
  });

  it("gives the second Gemini model the full 4 tries when there is no Groq key behind it", async () => {
    const net = network(unavailable);
    const { chain } = createChainFromEnv({ GEMINI_API_KEY: "g" }, net.options);

    await expect(chain.run((p) => p.complete(request))).rejects.toThrow();
    expect(net.requests.filter((r) => r.model === "gemini-3.1-flash-lite")).toHaveLength(4);
  });
});
