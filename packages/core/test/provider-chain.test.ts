import { describe, expect, it } from "vitest";
import { BASE_COOLDOWN_MS, MAX_COOLDOWN_MS, PipelineError, createFakeProvider, createProviderChain } from "../src";
import type { FakeReply } from "../src";

const rateLimited = () => new PipelineError("LLM_RATE_LIMITED", "still rate limited after 2 attempts");
const down = () => new PipelineError("LLM_UNAVAILABLE", "HTTP 503");
const request = { system: "s", user: "u" };

/** Three named models whose behaviour each test scripts, and a clock the test owns. */
function chainOf(scripts: { primary: FakeReply[]; second?: FakeReply[]; third?: FakeReply[] }) {
  let time = 0;
  const primary = createFakeProvider(scripts.primary, "gemini-3.5-flash-lite");
  const second = createFakeProvider(scripts.second ?? [], "gemini-3.1-flash-lite");
  const third = createFakeProvider(scripts.third ?? [], "qwen/qwen3.8-27b");
  const chain = createProviderChain([primary, second, third], { now: () => time });
  return { chain, primary, second, third, advance: (ms: number) => (time += ms) };
}

describe("provider chain — order", () => {
  it("uses the first model when it works, and never touches the others", async () => {
    const h = chainOf({ primary: ["ok"] });
    const result = await h.chain.run((p) => p.complete(request));

    expect(result).toMatchObject({ provider: "gemini-3.5-flash-lite", usedFallback: false, failures: [] });
    expect(h.second.calls).toHaveLength(0);
  });

  it("moves to the second model when the first fails, and says so", async () => {
    const h = chainOf({ primary: [rateLimited()], second: ["ok"] });
    const result = await h.chain.run((p) => p.complete(request));

    expect(result.provider).toBe("gemini-3.1-flash-lite");
    expect(result.usedFallback).toBe(true);
    expect(result.failures).toEqual([
      { provider: "gemini-3.5-flash-lite", code: "LLM_RATE_LIMITED", message: "still rate limited after 2 attempts" },
    ]);
  });

  it("reaches the third model, on a different provider, when both Gemini models fail", async () => {
    const h = chainOf({ primary: [down()], second: [down()], third: ["ok"] });
    expect((await h.chain.run((p) => p.complete(request))).provider).toBe("qwen/qwen3.8-27b");
  });

  it("reports every model it tried when all of them fail", async () => {
    const h = chainOf({ primary: [rateLimited()], second: [down()], third: [down()] });
    await expect(h.chain.run((p) => p.complete(request))).rejects.toMatchObject({
      name: "PipelineError",
      code: "LLM_UNAVAILABLE",
      message: expect.stringContaining(
        "gemini-3.5-flash-lite: LLM_RATE_LIMITED; gemini-3.1-flash-lite: LLM_UNAVAILABLE; qwen/qwen3.8-27b: LLM_UNAVAILABLE",
      ),
    });
  });

  it("behaves as a provider itself, so a step cannot tell one model from three", async () => {
    const h = chainOf({ primary: [down()], second: ["from the second model"] });
    expect(await h.chain.complete(request)).toMatchObject({ text: "from the second model", model: "gemini-3.1-flash-lite" });
    expect(h.chain.providers).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "qwen/qwen3.8-27b"]);
  });

  it("does not hide a bug behind a fallback", async () => {
    const h = chainOf({ primary: [new TypeError("cannot read properties of undefined")], second: ["ok"] });
    await expect(h.chain.run((p) => p.complete(request))).rejects.toBeInstanceOf(TypeError);
    expect(h.second.calls).toHaveLength(0);
  });

  it("refuses to be built with no models at all", () => {
    expect(() => createProviderChain([])).toThrow(/No model is configured/);
  });
});

describe("provider chain — cooldown", () => {
  it("skips a model that just failed, so later calls lose no time on it", async () => {
    const h = chainOf({ primary: [rateLimited()], second: ["a", "b", "c"] });

    await h.chain.run((p) => p.complete(request)); // primary fails here, once
    await h.chain.run((p) => p.complete(request));
    await h.chain.run((p) => p.complete(request));

    expect(h.primary.calls).toHaveLength(1);
    expect(h.second.calls).toHaveLength(3);
  });

  it("tries the model again once the cooldown has passed, and restores it on success", async () => {
    const h = chainOf({ primary: [rateLimited(), "primary is back", "still primary"], second: ["covering"] });

    await h.chain.run((p) => p.complete(request));
    h.advance(BASE_COOLDOWN_MS);
    const recovered = await h.chain.run((p) => p.complete(request));
    const after = await h.chain.run((p) => p.complete(request));

    expect(recovered).toMatchObject({ provider: "gemini-3.5-flash-lite", usedFallback: false });
    expect(after.provider).toBe("gemini-3.5-flash-lite");
  });

  it("doubles the cooldown each time the model is still failing, up to a cap", async () => {
    const replies: FakeReply[] = Array.from({ length: 8 }, rateLimited);
    const h = chainOf({ primary: replies, second: Array.from({ length: 40 }, () => "ok") });
    const call = () => h.chain.run((p) => p.complete(request));

    await call(); // fails -> skipped for 60s
    h.advance(BASE_COOLDOWN_MS - 1);
    await call();
    expect(h.primary.calls).toHaveLength(1); // still skipped at 59.999s

    h.advance(1);
    await call(); // retried at 60s, fails -> skipped for 120s
    expect(h.primary.calls).toHaveLength(2);

    h.advance(BASE_COOLDOWN_MS);
    await call();
    expect(h.primary.calls).toHaveLength(2); // 60s later is not enough any more

    h.advance(BASE_COOLDOWN_MS);
    await call();
    expect(h.primary.calls).toHaveLength(3); // 120s later it is

    for (let i = 0; i < 5; i++) {
      h.advance(MAX_COOLDOWN_MS);
      await call();
    }
    expect(h.primary.calls).toHaveLength(8); // the cap means it is always retried within 10 minutes
  });

  it("does not put a model on cooldown for a bad reply — it is up, it just answered badly", async () => {
    const invalid = new PipelineError("LLM_INVALID_JSON", "not json");
    const h = chainOf({ primary: [invalid, "fine this time"], second: ["covering"] });

    await h.chain.run((p) => p.complete(request));
    const next = await h.chain.run((p) => p.complete(request));
    expect(next.provider).toBe("gemini-3.5-flash-lite");
  });

  it("tries everything anyway when every model is cooling down", async () => {
    const h = chainOf({ primary: [down(), "back"], second: [down()], third: [down()] });
    await expect(h.chain.run((p) => p.complete(request))).rejects.toThrow();

    const result = await h.chain.run((p) => p.complete(request));
    expect(result.provider).toBe("gemini-3.5-flash-lite");
  });
});
