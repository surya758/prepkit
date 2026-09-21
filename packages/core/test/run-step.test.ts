import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineError, createContext, runStep } from "../src";
import type { ProgressEvent } from "../src";

// A clock the test controls, so durations and the deadline are exact.
function harness(options: { deadlineMs?: number; strict?: boolean } = {}) {
  let time = Date.parse("2026-09-21T10:00:00Z");
  const events: ProgressEvent[] = [];
  const ctx = createContext({
    deadlineMs: options.deadlineMs ?? 150_000,
    strict: options.strict,
    now: () => time,
    onProgress: (event) => events.push(event),
  });
  return { ctx, events, advance: (ms: number) => (time += ms) };
}

afterEach(() => vi.restoreAllMocks());

describe("runStep — success", () => {
  it("returns the step's result and emits started then completed with the duration", async () => {
    const { ctx, events, advance } = harness();
    const result = await runStep(ctx, { name: "company_brief", policy: "fatal" }, async () => {
      advance(1_200);
      return "brief";
    });

    expect(result).toBe("brief");
    expect(events).toEqual([
      { step: "company_brief", status: "started", at: "2026-09-21T10:00:00.000Z" },
      { step: "company_brief", status: "completed", at: "2026-09-21T10:00:01.200Z", durationMs: 1_200 },
    ]);
    expect(ctx.warnings).toEqual([]);
    expect(ctx.researchLog).toEqual([]);
  });
});

describe("runStep — fatal policy", () => {
  it("rethrows a PipelineError unchanged, after emitting failed", async () => {
    const { ctx, events } = harness();
    const error = new PipelineError("LLM_UNAVAILABLE", "Still rate-limited after 3 retries");

    await expect(
      runStep(ctx, { name: "jd_profile", policy: "fatal" }, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(events.at(-1)).toMatchObject({ step: "jd_profile", status: "failed" });
  });

  it("wraps any other error in a PipelineError carrying the step's failure code", async () => {
    const { ctx } = harness();
    const attempt = runStep(
      ctx,
      { name: "jd_profile", policy: "fatal", failureCode: "JD_PROFILE_FAILED" },
      async () => {
        throw new Error("socket hang up");
      },
    );
    await expect(attempt).rejects.toMatchObject({
      name: "PipelineError",
      code: "JD_PROFILE_FAILED",
      message: "jd_profile: socket hang up",
    });
  });
});

describe("runStep — degrade policy", () => {
  it("returns the fallback and records a warning and a research log entry", async () => {
    const { ctx, events } = harness();
    const result = await runStep(
      ctx,
      { name: "public_discussion", policy: "degrade", fallback: [] as string[], failureCode: "SEARCH_FAILED" },
      async () => {
        throw new Error("HTTP 503");
      },
    );

    expect(result).toEqual([]);
    expect(ctx.warnings).toEqual([{ code: "SEARCH_FAILED", message: "public_discussion: HTTP 503" }]);
    expect(ctx.researchLog).toEqual([
      { step: "public_discussion", url: null, outcome: "failed", reason: "HTTP 503" },
    ]);
    expect(events.at(-1)).toMatchObject({ status: "failed", message: "HTTP 503" });
  });

  it("keeps a PipelineError's own code in the warning", async () => {
    const { ctx } = harness();
    await runStep(ctx, { name: "questions:technical", policy: "degrade", fallback: [] }, async () => {
      throw new PipelineError("LLM_INVALID_JSON", "Model output did not match the schema");
    });
    expect(ctx.warnings[0]!.code).toBe("LLM_INVALID_JSON");
  });

  it("degrades past a bug but labels it INTERNAL_ERROR and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx } = harness();
    const result = await runStep(ctx, { name: "flashcards", policy: "degrade", fallback: "none" }, async () => {
      return (undefined as unknown as { length: number }).length as unknown as string;
    });

    expect(result).toBe("none");
    expect(ctx.warnings[0]!.code).toBe("INTERNAL_ERROR");
    expect(logged).toHaveBeenCalledOnce();
  });

  it("rethrows a bug in strict mode instead of hiding it", async () => {
    const { ctx } = harness({ strict: true });
    const attempt = runStep(ctx, { name: "flashcards", policy: "degrade", fallback: "none" }, async () => {
      return (undefined as unknown as { length: number }).length as unknown as string;
    });
    await expect(attempt).rejects.toBeInstanceOf(TypeError);
    expect(ctx.warnings).toEqual([]);
  });
});

describe("runStep — deadline", () => {
  it("skips a skippable step once the deadline has passed, without running it", async () => {
    const { ctx, events, advance } = harness({ deadlineMs: 150_000 });
    advance(150_000);
    const fn = vi.fn(async () => ["card"]);

    const result = await runStep(
      ctx,
      { name: "flashcards", policy: "degrade", fallback: [] as string[], skipPastDeadline: true },
      fn,
    );

    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ step: "flashcards", status: "skipped" })]);
    expect(ctx.warnings[0]!.code).toBe("DEADLINE_REACHED");
    expect(ctx.researchLog[0]).toMatchObject({ step: "flashcards", outcome: "skipped" });
  });

  it("still runs the code-only tail after the deadline", async () => {
    const { ctx, advance } = harness({ deadlineMs: 150_000 });
    advance(200_000);
    const schedule = await runStep(ctx, { name: "schedule", policy: "fatal" }, async () => "scheduled");
    expect(schedule).toBe("scheduled");
  });

  it("runs a skippable step normally while there is time left", async () => {
    const { ctx, advance } = harness({ deadlineMs: 150_000 });
    advance(149_999);
    const result = await runStep(
      ctx,
      { name: "flashcards", policy: "degrade", fallback: [] as string[], skipPastDeadline: true },
      async () => ["card"],
    );
    expect(result).toEqual(["card"]);
  });
});
