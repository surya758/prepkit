import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineError, batchOutputSchema, runBatch } from "../src";
import type { BatchEntry, BatchOutput, LlmRequest, RunBatchOptions } from "../src";
import { scriptedModel, stepOf } from "./fixtures/scripted-model";
import { noDiscussionNetwork } from "./fixtures/scripted-model";
import { startCompanySites } from "./fixtures/company-sites";
import type { FixtureServer } from "./fixtures/company-sites";

let sites: FixtureServer;
beforeAll(async () => {
  sites = await startCompanySites();
});
afterAll(() => sites.close());

const FRONTEND_JD = "Frontend Engineer\n\nRequirements\n- 5+ years with React\n- You have mentored junior engineers";
const BACKEND_JD = "Backend Engineer\n\nRequirements\n- Strong SQL and PostgreSQL\n\nNice to have\n- Kafka";
const STUB_JD = "Developer wanted.\nApply now.";

const requirement = (text: string, kind: string, priority: string) => ({ text, kind, priority, evidence: text });

/** Reads whichever description it was sent, like a real model would. */
function profileFor(request: LlmRequest) {
  if (request.user.includes("UNREADABLE")) return new PipelineError("LLM_UNAVAILABLE", "every configured model failed");
  if (request.user.includes("Frontend")) {
    return { title: "Frontend Engineer", requirements: [requirement("5+ years with React", "technical", "must"), requirement("You have mentored junior engineers", "behavioural", "must")] };
  }
  if (request.user.includes("Backend")) {
    return { title: "Backend Engineer", requirements: [requirement("Strong SQL and PostgreSQL", "technical", "must"), requirement("Kafka", "technical", "nice")] };
  }
  return { title: "Developer", requirements: [] };
}

const research = { summary: "A company.", what_they_do: "It builds software.", hiring_stages: [] };
const model = () => scriptedModel({ profile: profileFor, research });
const options = (extra: Partial<RunBatchOptions> = {}): RunBatchOptions => ({
  llm: model(),
  allowPrivateHosts: true,
  strict: true,
  crawl: { sleep: async () => {}, maxAttempts: 1 },
  publicDiscussion: { fetchImpl: noDiscussionNetwork },
  ...extra,
});

describe("runBatch — the Appendix B contract", () => {
  it("writes one entry per input case, keyed by the given id, in a valid envelope", async () => {
    const output = await runBatch(
      [
        { id: "case-01", jd: FRONTEND_JD, company_url: `${sites.origin}/acme/`, days: 5 },
        { id: "case-02", jd: BACKEND_JD, company_url: `${sites.origin}/globex/`, days: 3 },
      ],
      options({ now: () => Date.parse("2026-09-01T09:12:44Z") }),
    );

    expect(batchOutputSchema.safeParse(output).success).toBe(true);
    expect(output.version).toBe("1.0");
    expect(output.generated_at).toBe("2026-09-01T09:12:44.000Z");
    expect(output.kits.map((k) => [k.id, k.status, k.error])).toEqual([
      ["case-01", "ok", null],
      ["case-02", "ok", null],
    ]);
  });

  it("uses the days given for each case", async () => {
    const output = await runBatch(
      [
        { id: "one-day", jd: FRONTEND_JD, company_url: "", days: 1 },
        { id: "sixty-days", jd: BACKEND_JD, company_url: "", days: 60 },
      ],
      options(),
    );
    const days = (entry: BatchEntry) => (entry.status === "ok" ? entry.kit.schedule.days.length : -1);
    expect(output.kits.map(days)).toEqual([1, 60]);
  });

  it("keeps entries in input order even though cases finish out of order", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const cases = ids.map((id, i) => ({ id, jd: i % 2 ? BACKEND_JD : FRONTEND_JD, company_url: i === 0 ? `${sites.origin}/acme/` : "", days: 2 }));
    const output = await runBatch(cases, options({ concurrency: 3 }));
    expect(output.kits.map((k) => k.id)).toEqual(ids);
  });
});

describe("runBatch — one bad case does not stop the run", () => {
  it("records a failed case and carries on with the rest", async () => {
    const output = await runBatch(
      [
        { id: "good-1", jd: FRONTEND_JD, company_url: `${sites.origin}/acme/`, days: 3 },
        { id: "model-down", jd: "UNREADABLE description", company_url: "", days: 3 },
        { id: "good-2", jd: BACKEND_JD, company_url: "", days: 3 },
      ],
      options(),
    );

    expect(output.kits.map((k) => k.status)).toEqual(["ok", "failed", "ok"]);
    expect(output.kits[1]).toEqual({
      id: "model-down",
      status: "failed",
      kit: null,
      error: { code: "LLM_UNAVAILABLE", message: "every configured model failed" },
    });
    expect(batchOutputSchema.safeParse(output).success).toBe(true);
  });

  it.each([
    ["days missing", { id: "x", jd: FRONTEND_JD, company_url: "" }],
    ["days as text", { id: "x", jd: FRONTEND_JD, company_url: "", days: "5" }],
    ["zero days", { id: "x", jd: FRONTEND_JD, company_url: "", days: 0 }],
    ["not an object", "just a string"],
    ["null", null],
  ])("records a malformed case as INVALID_INPUT: %s", async (_name, bad) => {
    const llm = model();
    const output = await runBatch([bad, { id: "fine", jd: BACKEND_JD, company_url: "", days: 2 }], options({ llm }));

    expect(output.kits[0]).toMatchObject({ status: "failed", kit: null, error: { code: "INVALID_INPUT" } });
    expect(output.kits[1]).toMatchObject({ id: "fine", status: "ok" });
  });

  it("gives a case with no usable id a positional one, so every input still has an entry", async () => {
    const output = await runBatch([{ jd: FRONTEND_JD, company_url: "", days: 2 }, { id: "", jd: "", company_url: "", days: 2 }], options());
    expect(output.kits.map((k) => k.id)).toEqual(["case-1", "case-2"]);
    expect(output.kits.map((k) => k.status)).toEqual(["failed", "failed"]); // no id / empty description
  });

  it("treats an unreachable company and a two-line description as ok, not failed", async () => {
    const output = await runBatch(
      [
        { id: "site-down", jd: FRONTEND_JD, company_url: "http://127.0.0.1:1/x/", days: 2 },
        { id: "stub", jd: STUB_JD, company_url: `${sites.origin}/globex/`, days: 2 },
      ],
      options(),
    );

    expect(output.kits.map((k) => k.status)).toEqual(["ok", "ok"]);
    const [down, stub] = output.kits as Extract<BatchEntry, { status: "ok" }>[];
    expect(down!.kit.warnings!.map((w) => w.code)).toContain("COMPANY_UNREACHABLE");
    expect(stub!.kit.role.requirements).toEqual([]);
    expect(stub!.kit.warnings!.map((w) => w.code)).toContain("JD_THIN");
  });

  it("rejects input that is not a list of cases", async () => {
    await expect(runBatch({ id: "not-an-array" }, options())).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns an empty, valid envelope for an empty list", async () => {
    const output = await runBatch([], options());
    expect(output.kits).toEqual([]);
    expect(batchOutputSchema.safeParse(output).success).toBe(true);
  });
});

describe("runBatch — the same description and company submitted twice", () => {
  it("researches once, and still builds each case's own schedule", async () => {
    const llm = model();
    const output = await runBatch(
      [
        { id: "first", jd: FRONTEND_JD, company_url: `${sites.origin}/acme/`, days: 2 },
        { id: "again", jd: FRONTEND_JD, company_url: `${sites.origin}/acme/`, days: 7 },
      ],
      options({ llm }),
    );

    expect(llm.calls.filter((c) => stepOf(c) === "profile")).toHaveLength(1); // read once, not twice
    const [first, again] = output.kits as Extract<BatchEntry, { status: "ok" }>[];
    expect(first!.kit.questions).toEqual(again!.kit.questions);
    expect(first!.kit.schedule.days).toHaveLength(2);
    expect(again!.kit.schedule).toMatchObject({ days_available: 7 });
    expect(again!.kit.schedule.days).toHaveLength(7);
    expect(batchOutputSchema.safeParse(output).success).toBe(true);
  });

  it("does not share work between cases that differ", async () => {
    const llm = model();
    await runBatch(
      [
        { id: "a", jd: FRONTEND_JD, company_url: "", days: 2 },
        { id: "b", jd: BACKEND_JD, company_url: "", days: 2 },
      ],
      options({ llm }),
    );
    expect(llm.calls.filter((c) => stepOf(c) === "profile")).toHaveLength(2);
  });
});

describe("runBatch — progress", () => {
  it("reports after every case with everything finished so far, as a valid partial output", async () => {
    const snapshots: BatchOutput[] = [];
    await runBatch(
      [
        { id: "a", jd: FRONTEND_JD, company_url: "", days: 2 },
        { id: "b", jd: BACKEND_JD, company_url: "", days: 2 },
        { id: "c", jd: STUB_JD, company_url: "", days: 2 },
      ],
      options({ concurrency: 1, onCaseDone: (_entry, progress) => void snapshots.push(structuredClone(progress.output)) }),
    );

    expect(snapshots.map((s) => s.kits.map((k) => k.id))).toEqual([["a"], ["a", "b"], ["a", "b", "c"]]);
    for (const snapshot of snapshots) expect(batchOutputSchema.safeParse(snapshot).success).toBe(true);
  });
});
