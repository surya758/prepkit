import { describe, expect, it } from "vitest";
import { createRateLimiter, estimateTokens } from "../src";

// A clock the test owns: sleeping just moves time forward, so nothing really waits.
function harness(requestsPerMinute: number, tokensPerMinute: number) {
  let time = 0;
  const limiter = createRateLimiter({
    requestsPerMinute,
    tokensPerMinute,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  return { limiter, now: () => time, advance: (ms: number) => (time += ms) };
}

/** Acquire n times in a row and report the time each call was let through. */
async function schedule(h: ReturnType<typeof harness>, n: number, tokens: number) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    await h.limiter.acquire(tokens);
    times.push(h.now());
  }
  return times;
}

describe("estimateTokens", () => {
  it("budgets about four characters per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("rate limiter — requests per minute", () => {
  it("lets the first call through immediately", async () => {
    const h = harness(15, 250_000);
    await h.limiter.acquire(1_000);
    expect(h.now()).toBe(0);
  });

  it("spaces calls out instead of bursting the whole minute's quota", async () => {
    const h = harness(15, 250_000); // 15/min -> average gap 4s -> minimum gap 2s
    expect(await schedule(h, 4, 100)).toEqual([0, 2_000, 4_000, 6_000]);
  });

  it("honours an explicit minimum gap, for providers that limit per second", async () => {
    // Mistral: 1 request per second. 60/min alone would allow two calls 500 ms apart.
    let time = 0;
    const limiter = createRateLimiter({
      requestsPerMinute: 60,
      tokensPerMinute: 250_000,
      minGapMs: 1_100,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    });
    const times: number[] = [];
    for (let i = 0; i < 4; i++) {
      await limiter.acquire(100);
      times.push(time);
    }
    expect(times).toEqual([0, 1_100, 2_200, 3_300]);
  });

  it("never lets more than the limit through in any 60 second window", async () => {
    const h = harness(15, 250_000);
    const times = await schedule(h, 40, 100);
    for (const start of times) {
      const inWindow = times.filter((t) => t >= start && t < start + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(15);
    }
  });

  it("finishes the brief's five-case batch (~40 calls) far inside fifteen minutes at 15 rpm", async () => {
    const h = harness(15, 250_000);
    const times = await schedule(h, 40, 2_400);
    expect(times.at(-1)!).toBeLessThan(4 * 60_000);
  });
});

describe("rate limiter — tokens per minute", () => {
  it("holds a call back until enough earlier tokens have aged out of the window", async () => {
    const h = harness(30, 16_000); // Gemma-like: generous requests, tight tokens
    const times = await schedule(h, 3, 6_000);
    // 6K + 6K fit; the third would make 18K, so it waits for the first to leave the window.
    expect(times).toEqual([0, 1_000, 60_000]);
  });

  it("never lets more than the token limit through in any 60 second window", async () => {
    const h = harness(30, 16_000);
    const times = await schedule(h, 20, 5_000);
    for (const start of times) {
      const tokens = times.filter((t) => t >= start && t < start + 60_000).length * 5_000;
      expect(tokens).toBeLessThanOrEqual(16_000);
    }
  });

  it("lets a single oversized call through on an empty window rather than waiting forever", async () => {
    const h = harness(30, 16_000);
    await h.limiter.acquire(40_000);
    expect(h.now()).toBe(0);
  });

  it("uses the settled token count, so an overestimate does not hold up later calls", async () => {
    const h = harness(30, 16_000);
    const first = await h.limiter.acquire(12_000);
    first.settle(2_000);
    await h.limiter.acquire(12_000);
    expect(h.now()).toBe(1_000); // only the minimum gap, not a one-minute wait
  });

  it("uses the settled token count when the estimate was too low", async () => {
    const h = harness(30, 16_000);
    const first = await h.limiter.acquire(1_000);
    first.settle(15_000);
    await h.limiter.acquire(5_000);
    expect(h.now()).toBe(60_000);
  });
});

describe("rate limiter — shared by concurrent callers", () => {
  it("serves simultaneous callers in order, each with its own slot", async () => {
    const h = harness(15, 250_000);
    const order: string[] = [];
    await Promise.all(
      ["case-01", "case-02", "case-03"].map(async (id) => {
        await h.limiter.acquire(100);
        order.push(`${id}@${h.now()}`);
      }),
    );
    expect(order).toEqual(["case-01@0", "case-02@2000", "case-03@4000"]);
  });

  it("pauses everyone when the provider says to back off", async () => {
    const h = harness(15, 250_000);
    await h.limiter.acquire(100);
    h.limiter.pause(30_000); // a 429 with Retry-After: 30
    await h.limiter.acquire(100);
    expect(h.now()).toBe(30_000);
  });

  it("keeps the longer of two overlapping pauses", async () => {
    const h = harness(15, 250_000);
    h.limiter.pause(30_000);
    h.limiter.pause(5_000);
    await h.limiter.acquire(100);
    expect(h.now()).toBe(30_000);
  });
});
