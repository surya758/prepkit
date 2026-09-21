import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineError, generateKit, validateKit } from "../src";
import type { GenerateKitOptions, ProgressEvent } from "../src";
import { createFakeProvider } from "../src/testing";
import type { FakeReply } from "../src/testing";
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

/** A model that answers by which step is asking, so the two parallel steps cannot swap replies. */
function scriptedModel(replies: { profile?: FakeReply; research?: FakeReply } = {}) {
  return createFakeProvider((request) =>
    request.user.startsWith("<job_description>") ? (replies.profile ?? profileReply) : (replies.research ?? researchReply),
  );
}

const options = (extra: Partial<GenerateKitOptions> = {}): GenerateKitOptions => ({
  llm: scriptedModel(),
  allowPrivateHosts: true,
  strict: true,
  crawl: { sleep: async () => {}, maxAttempts: 1 },
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

  it("reports every requirement as uncovered while there are no questions, rather than claiming coverage", async () => {
    const kit = await generateKit({ jd: JD, companyUrl: `${sites.origin}/acme/`, days: 3 }, options());
    expect(kit.questions).toEqual([]);
    expect(kit.coverage).toEqual({ uncovered_requirement_ids: ["r1", "r2", "r3"], passes: 1 });
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
    expect(llm.calls).toHaveLength(1); // only the description was read; nothing was made up about the company
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
