import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineError, generateKit, validateKit } from "../src";
import type { GenerateKitOptions, ProgressEvent } from "../src";
import { createFakeProvider } from "../src/testing";
import { categoryOf, goodQuestions, isRepairCall, scriptedModel as stepAwareModel, stepOf } from "./fixtures/scripted-model";
import type { Script } from "./fixtures/scripted-model";
import { noDiscussionNetwork } from "./fixtures/scripted-model";
import { startCompanySites } from "./fixtures/company-sites";
import type { FixtureServer } from "./fixtures/company-sites";

let sites: FixtureServer;
beforeAll(async () => {
  sites = await startCompanySites();
});
afterAll(() => sites.close());

const JD = `Senior Frontend Engineer

Requirements
- 5+ years with React
- You have mentored junior engineers

Nice to have
- Logistics domain knowledge`;

const profileReply = {
  title: "Senior Frontend Engineer",
  seniority: "senior",
  requirements: [
    { text: "5+ years with React", kind: "technical", priority: "must", evidence: "5+ years with React" },
    { text: "You have mentored junior engineers", kind: "behavioural", priority: "must", evidence: "You have mentored junior engineers" },
    { text: "Logistics domain knowledge", kind: "domain", priority: "nice", evidence: "Logistics domain knowledge" },
  ],
};
const researchReply = {
  summary: "Acme builds route planning software.",
  what_they_do: "Route planning for mid-size retailers.",
  hiring_stages: [
    { name: "Intro call", description: "With a recruiter", evidence: "a 30 minute intro call with a recruiter" },
    { name: "Take-home exercise", description: "About three hours", evidence: "a take-home exercise of about three hours" },
  ],
};

/** The shared step-aware fake, defaulting to a well-behaved model for this description and site. */
function scriptedModel(replies: Script = {}) {
  return stepAwareModel({ profile: profileReply, research: researchReply, ...replies });
}

const options = (extra: Partial<GenerateKitOptions> = {}): GenerateKitOptions => ({
  llm: scriptedModel(),
  allowPrivateHosts: true,
  strict: true,
  crawl: { sleep: async () => {}, maxAttempts: 1 },
  publicDiscussion: { fetchImpl: noDiscussionNetwork },
  ...extra,
});

describe("generateKit — end to end against a company site", () => {
  it("produces a kit that satisfies the Appendix A structure", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 5 }, options());
    expect(validateKit(kit)).toMatchObject({ ok: true });
  });

  it("fills every section from the step that owns it", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 5 }, options());

    expect(kit.source).toMatchObject({
      company: "Acme",
      company_url: `${sites.origin}/acme/`,
      role: "Senior Frontend Engineer",
      location: "",
      jd_chars: JD.length,
    });
    expect(kit.source.pages_used).toContain(`${sites.origin}/acme/handbook/join-the-crew`);
    expect(kit.role.requirements.map((r) => [r.id, r.priority])).toEqual([
      ["r1", "must"],
      ["r2", "must"],
      ["r3", "nice"],
    ]);
    expect(kit.company_brief.summary).toBe("Acme builds route planning software.");
    expect(kit.hiring_process).toMatchObject({ found: true, stages: [{ name: "Intro call" }, { name: "Take-home exercise" }] });
    expect(kit.requirement_evidence).toEqual({
      r1: "5+ years with React",
      r2: "You have mentored junior engineers",
      r3: "Logistics domain knowledge",
    });
  });

  it("spans exactly the days asked for", async () => {
    for (const days of [1, 5, 60]) {
      const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days }, options());
      expect(kit.schedule.days_available).toBe(days);
      expect(kit.schedule.days).toHaveLength(days);
    }
  });

  it("covers every requirement with a question, and schedules every question", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options());

    expect(kit.coverage).toEqual({ uncovered_requirement_ids: [], passes: 1 });
    expect(new Set(kit.questions.map((q) => q.category))).toEqual(new Set(["technical", "behavioural", "system-design", "company-fit"]));

    const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
    expect(kit.questions.every((q) => scheduled.has(q.id))).toBe(true);
  });

  it("includes flashcards whose requirement ids all exist", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options());
    expect(kit.flashcards.map((f) => f.id)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(kit.flashcards.flatMap((f) => f.requirement_ids).sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("ships without flashcards, and says why, when only that step fails", async () => {
    const llm = scriptedModel({ flashcards: new PipelineError("LLM_INVALID_JSON", "no usable JSON after one re-ask") });
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options({ llm }));

    expect(validateKit(kit)).toMatchObject({ ok: true });
    expect(kit.flashcards).toEqual([]);
    expect(kit.questions.length).toBeGreaterThan(0);
    // completeJson re-asked once before giving up, so the message is its own; the code is what matters.
    expect(kit.warnings).toEqual([expect.objectContaining({ code: "LLM_INVALID_JSON", message: expect.stringContaining("flashcards:") })]);
  });

  it("runs the second pass when the first draft misses a must-have, and reports two passes", async () => {
    const llm = scriptedModel({
      questions: (request) => {
        const reply = goodQuestions(request) as { questions: { requirement_ids: string[] }[] };
        return isRepairCall(request) ? reply : { questions: reply.questions.filter((q) => !q.requirement_ids.includes("r2")) };
      },
    });
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/globex/`, days: 3 }, options({ llm }));

    expect(kit.coverage).toEqual({ uncovered_requirement_ids: [], passes: 2 });
    expect(kit.questions.some((q) => q.requirement_ids.includes("r2"))).toBe(true);
  });

  it("records what the crawler did in the kit's research log", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options());
    expect(kit.research_log).toContainEqual({
      step: "crawl",
      url: `${sites.origin}/acme/drafts/hiring-2027`,
      outcome: "skipped",
      reason: "Disallowed by /acme/robots.txt",
    });
    expect(kit.research_log).toContainEqual(expect.objectContaining({ step: "hiring_page", outcome: "ok" }));
  });

  it("emits progress for every step, in an order a UI can show", async () => {
    const events: ProgressEvent[] = [];
    await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options({ onProgress: (e) => events.push(e) }));

    const completed = events.filter((e) => e.status === "completed").map((e) => e.step);
    expect(completed).toEqual(expect.arrayContaining(["validate_input", "crawl_company_site", "jd_profile", "company_research", "coverage_check", "schedule", "validate_kit"]));
    expect(completed.at(-1)).toBe("validate_kit");
    expect(events.filter((e) => e.status === "started").slice(0, 3).map((e) => e.step)).toEqual([
      "validate_input",
      "crawl_company_site",
      "jd_profile",
    ]);
  });
});

describe("generateKit — public discussion of the interview process", () => {
  const hackerNews = (hits: object[]) =>
    (async () => new Response(JSON.stringify({ hits }), { status: 200 })) as unknown as typeof fetch;

  it("records that it searched and found nothing, which is the usual case", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options());

    expect(kit.public_discussion).toEqual({ searched: true, source: "Hacker News", query: '"Acme" interview', hits: [] });
    expect(kit.research_log).toContainEqual(expect.objectContaining({ step: "public_discussion", outcome: "empty" }));
    expect(validateKit(kit)).toMatchObject({ ok: true });
  });

  it("puts what it found in the kit, and gives it to the company-fit prompt only, as unverified", async () => {
    const llm = scriptedModel();
    const fetchImpl = hackerNews([
      {
        objectID: "41000001",
        story_title: "Ask HN: interviews",
        comment_text: "The interview process at Acme was a take-home and then a system design round.",
        created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options({ llm, publicDiscussion: { fetchImpl } }));

    expect(kit.public_discussion!.hits).toEqual([
      {
        title: "Ask HN: interviews",
        url: "https://news.ycombinator.com/item?id=41000001",
        excerpt: expect.stringContaining("interview process at Acme"),
        posted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);
    const questionCalls = llm.calls.filter((c) => stepOf(c) === "questions");
    const seen = questionCalls.filter((c) => c.user.includes("<public_discussion>")).map(categoryOf);
    expect(seen).toEqual(["company-fit"]);
    const companyFit = questionCalls.find((c) => categoryOf(c) === "company-fit")!;
    expect(companyFit.system).toContain("never state anything from it as fact");
    expect(companyFit.user).toMatch(/<public_discussion>\n- \(20\d\d\) /); // the year travels with the excerpt
  });

  it("does not search when the company's name is unknown, and the kit still ships", async () => {
    const fetchImpl = (async () => {
      throw new Error("the search API must not be called");
    }) as unknown as typeof fetch;
    const kit = await generateKit({ jd: JD, companyUrl: "", days: 2 }, options({ publicDiscussion: { fetchImpl } }));

    expect(kit.public_discussion).toMatchObject({ searched: false, hits: [] });
    expect(validateKit(kit)).toMatchObject({ ok: true });
  });

  it("survives the search API being down", async () => {
    const fetchImpl = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 2 }, options({ publicDiscussion: { fetchImpl } }));

    expect(kit.public_discussion).toMatchObject({ searched: false, hits: [] });
    expect(kit.research_log).toContainEqual(expect.objectContaining({ step: "public_discussion", outcome: "failed" }));
    expect(kit.questions.length).toBeGreaterThan(0);
  });
});

describe("generateKit — the company cannot be researched", () => {
  it.each([
    ["a site that is down", "http://127.0.0.1:1/acme/"],
    ["a 404", "SITE/nobody-here/"],
    ["a malformed URL", "not a url"],
    ["an empty URL", ""],
  ])("still produces a valid kit from the description alone: %s", async (_name, url) => {
    const llm = scriptedModel();
    const kit = await generateKit({ jd: JD, companyUrl: url.replace("SITE", sites.origin), days: 4 }, options({ llm }));

    expect(validateKit(kit)).toMatchObject({ ok: true });
    expect(kit.role.requirements).toHaveLength(3);
    expect(kit.source.pages_used).toEqual([]);
    expect(kit.company_brief.sources).toEqual([]);
    expect(kit.company_brief.summary).toContain("intentionally empty rather than guessed");
    expect(kit.hiring_process).toEqual({ found: false, stages: [], source: null });
    expect(kit.warnings!.map((w) => w.code)).toEqual(expect.arrayContaining(["COMPANY_UNREACHABLE", "COMPANY_NOT_RESEARCHED"]));
    // Nothing was asked, and so nothing made up, about a company we could not read.
    expect(llm.calls.filter((c) => stepOf(c) === "research")).toHaveLength(0);
    expect(llm.calls.map(categoryOf)).not.toContain("company-fit");
    expect(kit.questions.length).toBeGreaterThan(0); // the description alone still yields questions
  });

  it("falls back to the company name the description states", async () => {
    const llm = scriptedModel({ profile: { ...profileReply, company: "Ledgerly" } });
    const kit = await generateKit({ jd: JD, companyUrl: "", days: 2 }, options({ llm }));
    expect(kit.source.company).toBe("Ledgerly");
  });

  it("says so when the site has no hiring page", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/globex/`, days: 2 }, options());
    expect(kit.hiring_process).toEqual({ found: false, stages: [], source: null });
    expect(kit.warnings!.map((w) => w.code)).toContain("NO_HIRING_PAGE");
    expect(kit.source.company).toBe("Globex");
  });
});

describe("generateKit — a description with almost nothing in it", () => {
  it("produces a thin kit that says so", async () => {
    const llm = scriptedModel({ profile: { title: "Developer", requirements: [] } });
    const kit = await generateKit({ jd: "Developer wanted.\nApply now.", companyUrl: `${sites.origin}/acme/`, days: 3 }, options({ llm }));

    expect(validateKit(kit)).toMatchObject({ ok: true });
    expect(kit.role.requirements).toEqual([]);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.schedule.days).toHaveLength(3);
    expect(kit.warnings!.map((w) => w.code)).toContain("JD_THIN");
  });
});

describe("generateKit — failures", () => {
  it.each([
    ["an empty description", { jd: "  ", companyUrl: "", days: 3 }],
    ["zero days", { jd: JD, companyUrl: "", days: 0 }],
    ["fractional days", { jd: JD, companyUrl: "", days: 2.5 }],
    ["too many days", { jd: JD, companyUrl: "", days: 400 }],
  ])("rejects %s before calling the model or the site", async (_name, input) => {
    const llm = scriptedModel();
    await expect(generateKit(input, options({ llm }))).rejects.toMatchObject({ name: "PipelineError", code: "INVALID_INPUT" });
    expect(llm.calls).toHaveLength(0);
  });

  it("fails the kit when the description cannot be read, keeping the model's error code", async () => {
    const llm = scriptedModel({ profile: new PipelineError("LLM_UNAVAILABLE", "every configured model failed") });
    await expect(generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options({ llm }))).rejects.toMatchObject({
      code: "LLM_UNAVAILABLE",
    });
  });

  it("still ships the kit when only the company research fails", async () => {
    const llm = scriptedModel({ research: new PipelineError("LLM_RATE_LIMITED", "429 from every model") });
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options({ llm }));

    expect(validateKit(kit)).toMatchObject({ ok: true });
    expect(kit.role.requirements).toHaveLength(3);
    expect(kit.source.pages_used.length).toBeGreaterThan(0); // the pages were fetched...
    expect(kit.company_brief.summary).toContain("could not be summarised"); // ...but not summarised, and it says so
    expect(kit.warnings).toContainEqual({ code: "LLM_RATE_LIMITED", message: "company_research: 429 from every model" });
  });

  it("skips optional model steps once out of time, and still ships a valid kit", async () => {
    let time = 1_000_000;
    const llm = createFakeProvider((request) => {
      if (request.user.startsWith("<job_description>")) time += 200_000; // reading the description used the whole budget
      return request.user.startsWith("<job_description>") ? profileReply : researchReply;
    });
    const kit = await generateKit(
      { jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 },
      options({ llm, now: () => time, deadlineMs: 150_000 }),
    );

    expect(validateKit(kit)).toMatchObject({ ok: true });
    expect(llm.calls).toHaveLength(1);
    expect(kit.warnings!.map((w) => w.code)).toContain("DEADLINE_REACHED");
    expect(kit.schedule.days).toHaveLength(3); // the code-only tail always runs
  });
});
