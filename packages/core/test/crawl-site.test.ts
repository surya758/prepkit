import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crawlSite } from "../src";
import type { CrawlOptions } from "../src";
import { startCompanySites } from "./fixtures/company-sites";
import type { FixtureServer } from "./fixtures/company-sites";

let sites: FixtureServer;
beforeAll(async () => {
  sites = await startCompanySites();
});
afterAll(() => sites.close());
beforeEach(() => sites.hits.clear());

const local: CrawlOptions = { allowPrivateHosts: true, sleep: async () => {} };
const paths = (urls: string[]) => urls.map((u) => new URL(u).pathname);

describe("crawlSite — a site whose hiring page is at an unpredictable path (Acme)", () => {
  it("finds the hiring page two clicks deep, behind a link called 'Join the crew'", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, local);

    expect(result.reachable).toBe(true);
    expect(result.hiringPage?.url).toBe(`${sites.origin}/acme/handbook/join-the-crew`);
    expect(result.hiringPage?.hiring.describesProcess).toBe(true);
    expect(result.log.at(-1)).toEqual({
      step: "hiring_page",
      url: `${sites.origin}/acme/handbook/join-the-crew`,
      outcome: "ok",
      reason: "Describes the interview process",
    });
  });

  it("collects the pages that say what the company does, and works out its name from the titles", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, local);
    expect(result.companyName).toBe("Acme");
    expect(paths(result.pages.map((p) => p.url))).toEqual(
      expect.arrayContaining(["/acme/", "/acme/about", "/acme/product", "/acme/handbook/"]),
    );
    expect(result.pages[0]).toMatchObject({ kind: "home", depth: 0 });
  });

  it("never hands hidden text to the rest of the pipeline", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, local);
    expect(result.hiringPage?.text).toContain("take-home exercise");
    expect(JSON.stringify(result.pages)).not.toContain("COBOL");
  });

  it("skips a page robots.txt disallows, and says so in the log", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, local);
    expect(result.log).toContainEqual({
      step: "crawl",
      url: `${sites.origin}/acme/drafts/hiring-2027`,
      outcome: "skipped",
      reason: "Disallowed by /acme/robots.txt",
    });
    expect(sites.hits.has("/acme/drafts/hiring-2027")).toBe(false);
  });

  it("stays inside the company's folder: another company's careers page is not fetched", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, local);
    expect(sites.hits.has("/globex/careers")).toBe(false);
    expect(paths(result.pages.map((p) => p.url)).every((p) => p.startsWith("/acme/"))).toBe(true);
  });

  it("does not waste requests on noise links", async () => {
    await crawlSite(`${sites.origin}/acme/`, local);
    expect(sites.hits.has("/acme/privacy")).toBe(false);
  });

  it("treats /acme and /acme/ as the same site folder", async () => {
    const result = await crawlSite(`${sites.origin}/acme/about`, local);
    // /acme/about has no dot, so it is read as a folder; its links still resolve under /acme/.
    expect(result.reachable).toBe(true);
  });
});

describe("crawlSite — a site with no hiring page (Globex)", () => {
  it("reports that honestly instead of guessing", async () => {
    const result = await crawlSite(`${sites.origin}/globex/`, local);

    expect(result.reachable).toBe(true);
    expect(result.hiringPage).toBeUndefined();
    expect(result.pages.length).toBeGreaterThanOrEqual(3);
    expect(result.log.at(-1)).toEqual({
      step: "hiring_page",
      url: null,
      outcome: "empty",
      reason: "No hiring page found on the company site",
    });
  });
});

describe("crawlSite — a broken link (Initech)", () => {
  it("records the 404 and carries on with the rest of the site", async () => {
    const result = await crawlSite(`${sites.origin}/initech/`, local);

    expect(result.log).toContainEqual({
      step: "crawl",
      url: `${sites.origin}/initech/careers`,
      outcome: "failed",
      reason: "HTTP_ERROR: HTTP 404",
    });
    expect(paths(result.pages.map((p) => p.url))).toEqual(["/initech/", "/initech/about"]);
    expect(result.hiringPage).toBeUndefined();
  });

  it("does not adopt another company's careers page as its own", async () => {
    // Initech's nav links to /globex/careers. With nothing on hiring inside /initech/, the
    // crawler gives that link one hop — and must notice the page belongs to Globex.
    const result = await crawlSite(`${sites.origin}/initech/`, local);

    expect(sites.hits.get("/globex/careers")).toBe(1);
    expect(result.hiringPage).toBeUndefined();
    expect(JSON.stringify(result.pages)).not.toContain("Globex");
    expect(result.log).toContainEqual({
      step: "crawl",
      url: `${sites.origin}/globex/careers`,
      outcome: "skipped",
      reason: "Belongs to a different site",
    });
  });
});

describe("crawlSite — a company URL that cannot be used", () => {
  it("returns reachable: false for a site that is down, without throwing", async () => {
    const result = await crawlSite("http://127.0.0.1:1/acme/", { ...local, maxAttempts: 1 });
    expect(result).toMatchObject({ reachable: false, pages: [], companyName: "" });
    expect(result.log[0]).toMatchObject({ step: "crawl", outcome: "failed" });
  });

  it("returns reachable: false for a 404 company URL", async () => {
    const result = await crawlSite(`${sites.origin}/nobody-here/`, local);
    expect(result.reachable).toBe(false);
    expect(result.log[0]).toMatchObject({ outcome: "failed", reason: "HTTP_ERROR: HTTP 404" });
  });

  it.each(["", "not a url", "ftp://example.com/"])("returns reachable: false for %j", async (url) => {
    const result = await crawlSite(url, local);
    expect(result.reachable).toBe(false);
    expect(result.log).toHaveLength(1);
  });

  it("refuses a private address in production mode", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, { allowPrivateHosts: false, sleep: async () => {} });
    expect(result.reachable).toBe(false);
    expect(sites.hits.size).toBe(0);
  });
});

describe("crawlSite — budget and pacing", () => {
  it("stops at the page budget, and the out-of-folder fallback respects it too", async () => {
    const result = await crawlSite(`${sites.origin}/acme/`, { ...local, maxPages: 3 });
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.kind).toBe("home");
    expect(sites.hits.has("/globex/careers")).toBe(false);
  });

  it("stops when told it is out of time", async () => {
    const full = await crawlSite(`${sites.origin}/acme/`, local);
    let pagesAllowed = 2;
    const result = await crawlSite(`${sites.origin}/acme/`, { ...local, shouldStop: () => pagesAllowed-- <= 0 });

    expect(result.pages.length).toBeLessThan(full.pages.length);
    expect(result.pages[0]!.kind).toBe("home");
    expect(result.log).toContainEqual({ step: "crawl", url: null, outcome: "skipped", reason: "Stopped crawling: out of time" });
  });

  it("does not pause between requests to a loopback host", async () => {
    const sleep = vi.fn(async () => {});
    await crawlSite(`${sites.origin}/globex/`, { allowPrivateHosts: true, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});
