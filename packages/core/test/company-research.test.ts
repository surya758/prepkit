import { describe, expect, it } from "vitest";
import { briefWithoutResearch, createContext, hiringProcessSchema, researchCompany } from "../src";
import type { CrawlResult, CrawledPage } from "../src";
import { createFakeProvider } from "../src/testing";

const ctx = () => createContext({ deadlineMs: 150_000, strict: true });
const BASE = "http://localhost:8099/acme";

const page = (path: string, kind: CrawledPage["kind"], text: string, describesProcess = false): CrawledPage => ({
  url: `${BASE}${path}`,
  title: `${path} | Acme`,
  text,
  truncated: false,
  kind,
  depth: kind === "home" ? 0 : 1,
  hiring: { score: describesProcess ? 12 : 0, isHiringPage: kind === "hiring", describesProcess, signals: [] },
});

const home = page("/", "home", "Acme builds route planning software for mid-size retailers.");
const about = page("/about", "about", "Founded in 2019, Acme plans two million deliveries a month.");
const hiring = page(
  "/handbook/join-the-crew",
  "hiring",
  "## How we hire\nEvery candidate starts with a 30 minute intro call with a recruiter.\nNext is a take-home exercise of about three hours.\nThe final round is a system design interview.",
  true,
);

const crawlOf = (pages: CrawledPage[], hiringPage?: CrawledPage): CrawlResult => ({
  reachable: true,
  companyName: "Acme",
  pages,
  hiringPage,
  log: [],
});

const reply = {
  summary: "Acme builds route planning software.",
  what_they_do: "Route planning for mid-size retailers, planning two million deliveries a month.",
  hiring_stages: [
    { name: "Intro call", description: "30 minutes with a recruiter", evidence: "a 30 minute intro call with a recruiter" },
    { name: "Take-home exercise", description: "About three hours", evidence: "Next is a take-home exercise of about three hours." },
    { name: "System design interview", description: "Final round", evidence: "The final round is a system design interview." },
  ],
};

describe("researchCompany — a site with a published interview process", () => {
  it("returns the brief, the stages in order, and the pages it was written from", async () => {
    const context = ctx();
    const result = await researchCompany(createFakeProvider([reply]), crawlOf([home, about, hiring], hiring), context);

    expect(result.brief).toEqual({
      summary: reply.summary,
      what_they_do: reply.what_they_do,
      sources: [`${BASE}/handbook/join-the-crew`, `${BASE}/`, `${BASE}/about`],
    });
    expect(result.hiringProcess).toEqual({
      found: true,
      source: `${BASE}/handbook/join-the-crew`,
      stages: [
        { name: "Intro call", description: "30 minutes with a recruiter" },
        { name: "Take-home exercise", description: "About three hours" },
        { name: "System design interview", description: "Final round" },
      ],
    });
    expect(hiringProcessSchema.safeParse(result.hiringProcess).success).toBe(true);
    expect(context.warnings).toEqual([]);
  });

  it("sends pages as delimited data with their URLs, hiring page first", async () => {
    const model = createFakeProvider([reply]);
    await researchCompany(model, crawlOf([home, about, hiring], hiring), ctx());

    const user = model.calls[0]!.user;
    expect(user.indexOf("join-the-crew")).toBeLessThan(user.indexOf(`<page url="${BASE}/"`));
    expect(user).toContain(`<page url="${BASE}/about" title="/about | Acme">`);
    expect(model.calls[0]!.system).not.toContain("Acme");
  });

  it("lists as sources the pages that were sent, not whatever the model claims", async () => {
    const lying = { ...reply, sources: ["https://en.wikipedia.org/wiki/Acme"] };
    const result = await researchCompany(createFakeProvider([lying]), crawlOf([home], undefined), ctx());
    expect(result.brief.sources).toEqual([`${BASE}/`]);
  });

  it("drops an interview stage the hiring page does not describe, and logs it", async () => {
    const inventive = {
      ...reply,
      hiring_stages: [...reply.hiring_stages, { name: "Whiteboard algorithms round", description: "Classic", evidence: "a whiteboard algorithms round" }],
    };
    const context = ctx();
    const result = await researchCompany(createFakeProvider([inventive]), crawlOf([home, hiring], hiring), context);

    expect(result.hiringProcess.stages.map((s) => s.name)).toEqual(["Intro call", "Take-home exercise", "System design interview"]);
    expect(context.researchLog.find((e) => e.outcome === "skipped")?.reason).toContain("Whiteboard algorithms round");
  });

  it("caps how much page text goes into the prompt", async () => {
    const huge = page("/blog", "about", "word ".repeat(5_000));
    const many = [home, ...Array.from({ length: 9 }, (_, i) => page(`/p${i}`, "about", `Page ${i} text.`)), huge];
    const model = createFakeProvider([reply]);
    await researchCompany(model, crawlOf(many), ctx());

    expect(model.calls[0]!.user.match(/<page /g)).toHaveLength(5);
    expect(model.calls[0]!.user.length).toBeLessThan(5 * 3_200);
  });
});

describe("researchCompany — honest about what was not found", () => {
  it("says so when the site has no hiring page, and ignores stages the model offers anyway", async () => {
    const context = ctx();
    const result = await researchCompany(createFakeProvider([reply]), crawlOf([home, about]), context);

    expect(result.hiringProcess).toEqual({ found: false, stages: [], source: null });
    expect(context.warnings.map((w) => w.code)).toEqual(["NO_HIRING_PAGE"]);
  });

  it("says so when there is a careers page that does not describe the process", async () => {
    const careers = page("/careers", "hiring", "We're hiring. See our open roles and apply.", false);
    const context = ctx();
    const result = await researchCompany(createFakeProvider([reply]), crawlOf([home, careers], careers), context);

    expect(result.hiringProcess).toEqual({ found: true, stages: [], source: `${BASE}/careers` });
    expect(context.warnings.map((w) => w.code)).toEqual(["HIRING_PROCESS_NOT_DESCRIBED"]);
  });

  it("makes no model call and writes a fixed, honest brief when the site was unreachable", async () => {
    const model = createFakeProvider([]);
    const context = ctx();
    const result = await researchCompany(model, { reachable: false, companyName: "", pages: [], log: [] }, context);

    expect(model.calls).toHaveLength(0);
    expect(result).toEqual(briefWithoutResearch("the company site could not be retrieved"));
    expect(result.brief.summary).toContain("intentionally empty rather than guessed");
    expect(result.brief.sources).toEqual([]);
    expect(context.warnings).toEqual([
      { code: "COMPANY_NOT_RESEARCHED", message: "The company brief is empty because the company site could not be retrieved" },
    ]);
  });

  it("does the same for a reachable site with nothing readable on it", async () => {
    const model = createFakeProvider([]);
    const result = await researchCompany(model, crawlOf([]), ctx());
    expect(result.brief.summary).toContain("the company site had no readable pages");
    expect(model.calls).toHaveLength(0);
  });
});
