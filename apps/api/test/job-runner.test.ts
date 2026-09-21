import { PipelineError } from "@prepkit/core";
import type { ProgressEvent } from "@prepkit/core";
import { describe, expect, it, vi } from "vitest";
import { INTERRUPTED, createJobRunner } from "../src/kits/job-runner";
import type { GenerateFn } from "../src/kits/job-runner";
import { createMemoryKitRepository } from "./support/memory-repositories";
import { sampleKit } from "./support/sample-kit";

const AT = new Date("2026-09-21T10:00:00Z");
const event = (step: string, status: ProgressEvent["status"]): ProgressEvent => ({ step, status, at: AT.toISOString() });

async function setup(generate: GenerateFn, concurrency = 2) {
  const kits = createMemoryKitRepository();
  const logError = vi.fn();
  const runner = createJobRunner({ kits, generate, concurrency, now: () => AT, logError });
  const queue = async (jd: string) => {
    const record = await kits.insert({
      userId: "user-1",
      input: { jd, companyUrl: "", days: 2 },
      fingerprint: jd,
      status: "queued",
      progress: [],
      error: null,
      kit: null,
      meta: null,
      rev: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    return record!.id;
  };
  return { kits, runner, logError, queue };
}

describe("job runner — a kit that generates", () => {
  it("moves the kit from queued to ready and stores the result", async () => {
    const { kits, runner, queue } = await setup(async () => sampleKit());
    const id = await queue("a description");

    runner.enqueue(id);
    await runner.idle();

    const record = (await kits.findForJob(id))!;
    expect(record.status).toBe("ready");
    expect(record.kit).toEqual(sampleKit());
    expect(record.error).toBeNull();
  });

  it("passes the stored input to the pipeline", async () => {
    const generate = vi.fn<GenerateFn>(async () => sampleKit());
    const { runner, queue } = await setup(generate);
    runner.enqueue(await queue("Senior Backend Engineer"));
    await runner.idle();
    expect(generate.mock.calls[0]![0]).toEqual({ jd: "Senior Backend Engineer", companyUrl: "", days: 2 });
  });

  it("saves every progress event as it happens, in the order it was reported", async () => {
    const seenWhileRunning: string[][] = [];
    const { kits, runner, queue } = await setup(async (_input, onProgress) => {
      onProgress(event("jd_profile", "started"));
      onProgress(event("crawl_company_site", "completed"));
      onProgress(event("jd_profile", "completed"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      // What a page polling mid-generation would see.
      seenWhileRunning.push((await kits.findForJob(id))!.progress.map((e) => `${e.step}:${e.status}`));
      onProgress(event("validate_kit", "completed"));
      return sampleKit();
    });
    const id = await queue("a description");

    runner.enqueue(id);
    await runner.idle();

    expect(seenWhileRunning[0]).toEqual(["jd_profile:started", "crawl_company_site:completed", "jd_profile:completed"]);
    expect((await kits.findForJob(id))!.progress.map((e) => e.step)).toEqual(["jd_profile", "crawl_company_site", "jd_profile", "validate_kit"]);
  });

  it("is running, not queued, while the pipeline works", async () => {
    let statusDuringRun = "";
    const { kits, runner, queue } = await setup(async () => {
      statusDuringRun = (await kits.findForJob(id))!.status;
      return sampleKit();
    });
    const id = await queue("a description");
    runner.enqueue(id);
    await runner.idle();
    expect(statusDuringRun).toBe("running");
  });
});

describe("job runner — a kit that fails", () => {
  it("records a pipeline failure with its own code and message", async () => {
    const { kits, runner, logError, queue } = await setup(async (_input, onProgress) => {
      onProgress(event("jd_profile", "failed"));
      throw new PipelineError("LLM_UNAVAILABLE", "Every configured model failed");
    });
    const id = await queue("a description");
    runner.enqueue(id);
    await runner.idle();

    const record = (await kits.findForJob(id))!;
    expect(record.status).toBe("failed");
    expect(record.error).toEqual({ code: "LLM_UNAVAILABLE", message: "Every configured model failed" });
    expect(record.progress).toHaveLength(1); // what happened before the failure is kept
    expect(logError).not.toHaveBeenCalled(); // an expected failure is not a bug
  });

  it("records a bug as INTERNAL_ERROR with a plain sentence, and logs the real error", async () => {
    const { kits, runner, logError, queue } = await setup(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'internalDetail')");
    });
    const id = await queue("a description");
    runner.enqueue(id);
    await runner.idle();

    const record = (await kits.findForJob(id))!;
    expect(record.error).toEqual({ code: "INTERNAL_ERROR", message: "Something went wrong while generating this kit. Please try again." });
    expect(JSON.stringify(record)).not.toContain("internalDetail");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(TypeError));
  });

  it("carries on with the next kit after one fails", async () => {
    const { kits, runner, queue } = await setup(async (input) => {
      if (input.jd === "bad") throw new PipelineError("INVALID_INPUT", "nope");
      return sampleKit();
    }, 1);
    const bad = await queue("bad");
    const good = await queue("good");
    runner.enqueue(bad);
    runner.enqueue(good);
    await runner.idle();

    expect((await kits.findForJob(bad))!.status).toBe("failed");
    expect((await kits.findForJob(good))!.status).toBe("ready");
  });
});

describe("job runner — the queue", () => {
  it("never runs more kits at once than its concurrency", async () => {
    let running = 0;
    let peak = 0;
    const { runner, queue } = await setup(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return sampleKit();
    }, 2);
    for (const jd of ["a", "b", "c", "d", "e"]) runner.enqueue(await queue(jd));
    await runner.idle();
    expect(peak).toBe(2);
  });

  it("skips a kit that was deleted while it waited", async () => {
    const generate = vi.fn<GenerateFn>(async () => sampleKit());
    const { kits, runner, queue } = await setup(generate);
    const id = await queue("a description");
    await kits.deleteOwned(id, "user-1");

    runner.enqueue(id);
    await runner.idle();
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not run the same kit twice if it is enqueued twice, even with a free slot for each", async () => {
    const generate = vi.fn<GenerateFn>(async () => sampleKit());
    const { runner, queue } = await setup(generate, 2);
    const id = await queue("a description");
    runner.enqueue(id);
    runner.enqueue(id);
    await runner.idle();
    expect(generate).toHaveBeenCalledOnce();
  });

  it("is idle straight away when there is nothing to do", async () => {
    const { runner } = await setup(async () => sampleKit());
    await expect(runner.idle()).resolves.toBeUndefined();
  });
});

describe("job runner — after a restart", () => {
  it("marks whatever the last process left unfinished as interrupted, and leaves the rest alone", async () => {
    const { kits, runner, queue } = await setup(async () => sampleKit());
    const stuckQueued = await queue("was queued");
    const stuckRunning = await queue("was running");
    const finished = await queue("was finished");
    await kits.claim(stuckRunning, AT);
    await kits.markReady(finished, sampleKit(), AT);

    expect(await runner.failInterrupted()).toBe(2);

    expect((await kits.findForJob(stuckQueued))!).toMatchObject({ status: "failed", error: INTERRUPTED });
    expect((await kits.findForJob(stuckRunning))!).toMatchObject({ status: "failed", error: INTERRUPTED });
    expect((await kits.findForJob(finished))!.status).toBe("ready");
  });
});
