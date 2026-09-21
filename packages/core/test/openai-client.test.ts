import { describe, expect, it, vi } from "vitest";
import { createOpenAiClient, createRateLimiter } from "../src";

// Scripted HTTP responses, consumed one per request, and a clock the test owns.
function harness(responses: (Response | Error)[]) {
  let time = 0;
  const sleep = vi.fn(async (ms: number) => {
    time += ms;
  });
  const limiter = createRateLimiter({ requestsPerMinute: 60, tokensPerMinute: 250_000, minGapMs: 0, now: () => time, sleep });
  const pause = vi.spyOn(limiter, "pause");
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("test ran out of scripted responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const client = createOpenAiClient({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: "test-key",
    model: "gemini-3.5-flash-lite",
    limiter,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
  });
  return { client, fetchImpl, sleep, pause, now: () => time };
}

const completion = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: "stop", message: { content }, ...extra }], usage: { total_tokens: 321 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
const status = (code: number, headers: Record<string, string> = {}, body = "") => new Response(body, { status: code, headers });
const request = { system: "Return JSON.", user: "Job description goes here." };

describe("openai-compatible client — request", () => {
  it("posts a chat completion in JSON mode with the key as a bearer token", async () => {
    const h = harness([completion('{"ok":true}')]);
    await h.client.complete({ ...request, maxOutputTokens: 500, temperature: 0 });

    const [url, init] = h.fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "gemini-3.5-flash-lite",
      messages: [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Job description goes here." },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });
  });

  it("returns the text, the model name and the provider's token count", async () => {
    const h = harness([completion('{"ok":true}')]);
    expect(await h.client.complete(request)).toEqual({
      text: '{"ok":true}',
      truncated: false,
      model: "gemini-3.5-flash-lite",
      totalTokens: 321,
    });
  });

  it("joins content returned as typed chunks", async () => {
    const h = harness([completion([{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }])]);
    expect((await h.client.complete(request)).text).toBe('{"a":1}');
  });

  it("flags a reply that stopped at the output limit", async () => {
    const h = harness([completion('{"questions":[', { finish_reason: "length" })]);
    expect((await h.client.complete(request)).truncated).toBe(true);
  });

  it("fails clearly, without calling anyone, when no key is configured", async () => {
    const limiter = createRateLimiter({ requestsPerMinute: 60, tokensPerMinute: 1_000 });
    const fetchImpl = vi.fn();
    const client = createOpenAiClient({ baseUrl: "https://x.test", apiKey: "", model: "m", limiter, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.complete(request)).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("openai-compatible client — being told to slow down", () => {
  it("pauses the shared limiter for Retry-After, then succeeds", async () => {
    const h = harness([status(429, { "retry-after": "7" }), completion('{"ok":true}')]);
    const result = await h.client.complete(request);

    expect(result.text).toBe('{"ok":true}');
    expect(h.pause).toHaveBeenCalledWith(7_000);
    expect(h.now()).toBe(7_000); // the retry really did wait
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("backs off on its own when the provider gives no Retry-After", async () => {
    const h = harness([status(429), completion('{"ok":true}')]);
    await h.client.complete(request);
    expect(h.pause).toHaveBeenCalledWith(4_000);
  });

  it("gives up with LLM_RATE_LIMITED after the last attempt", async () => {
    const h = harness([status(429), status(429), status(429), status(429)]);
    await expect(h.client.complete(request)).rejects.toMatchObject({
      name: "PipelineError",
      code: "LLM_RATE_LIMITED",
    });
    expect(h.fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe("openai-compatible client — provider trouble", () => {
  it("retries a 503 with backoff and succeeds when the provider recovers", async () => {
    const h = harness([status(503), completion('{"ok":true}')]);
    expect((await h.client.complete(request)).text).toBe('{"ok":true}');
    expect(h.sleep).toHaveBeenCalledWith(2_000);
  });

  it("retries a network failure", async () => {
    const h = harness([new TypeError("fetch failed"), completion('{"ok":true}')]);
    expect((await h.client.complete(request)).text).toBe('{"ok":true}');
  });

  it("retries a 200 whose body is not JSON", async () => {
    const h = harness([status(200, {}, "<html>Bad gateway</html>"), completion('{"ok":true}')]);
    expect((await h.client.complete(request)).text).toBe('{"ok":true}');
  });

  it("gives up with LLM_UNAVAILABLE when the provider stays down", async () => {
    const h = harness([status(500), status(502), status(503), status(504)]);
    await expect(h.client.complete(request)).rejects.toMatchObject({
      code: "LLM_UNAVAILABLE",
      message: "gemini-3.5-flash-lite failed after 4 attempts: HTTP 504",
    });
  });
});

describe("openai-compatible client — errors that retrying cannot fix", () => {
  it.each([
    [401, "LLM_AUTH_FAILED"],
    [403, "LLM_AUTH_FAILED"],
    [400, "LLM_REQUEST_REJECTED"],
    [404, "LLM_REQUEST_REJECTED"],
  ])("fails at once on HTTP %i with %s", async (code, expected) => {
    const h = harness([status(code, {}, '{"message":"nope"}')]);
    await expect(h.client.complete(request)).rejects.toMatchObject({ code: expected });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("includes the provider's explanation, which is how a wrong model id gets noticed", async () => {
    const h = harness([status(404, {}, '{"message":"model gemini-3.5-flash-lit not found"}')]);
    await expect(h.client.complete(request)).rejects.toThrow(/model gemini-3.5-flash-lit not found/);
  });
});
