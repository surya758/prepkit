import { describe, expect, it, vi } from "vitest";
import { createRobotsChecker, parseRobots } from "../src";
import type { FetchPageResult } from "../src";

describe("parseRobots", () => {
  it("allows everything when there are no rules", () => {
    expect(parseRobots("").isAllowed("/anything")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow:").isAllowed("/anything")).toBe(true);
  });

  it("applies Disallow as a path prefix", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private/");
    expect(rules.isAllowed("/private/salaries")).toBe(false);
    expect(rules.isAllowed("/private")).toBe(true);
    expect(rules.isAllowed("/careers")).toBe(true);
  });

  it("lets the longest matching rule win, and Allow win a tie", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /handbook/", "Allow: /handbook/hiring/", "Disallow: /tie", "Allow: /tie"].join("\n"),
    );
    expect(rules.isAllowed("/handbook/finance")).toBe(false);
    expect(rules.isAllowed("/handbook/hiring/process")).toBe(true);
    expect(rules.isAllowed("/tie")).toBe(true);
  });

  it("supports * wildcards and the $ end anchor, and matches the query string", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?q=");
    expect(rules.isAllowed("/files/report.pdf")).toBe(false);
    expect(rules.isAllowed("/files/report.pdf.html")).toBe(true);
    expect(rules.isAllowed("/search?q=interview")).toBe(false);
  });

  it("treats regex characters in a rule literally", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /a.b(c)");
    expect(rules.isAllowed("/a.b(c)")).toBe(false);
    expect(rules.isAllowed("/aXb(c)")).toBe(true);
  });

  it("prefers the group that names us over the wildcard group", () => {
    const text = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: InterviewPrepKit",
      "Disallow: /admin",
    ].join("\n");
    const rules = parseRobots(text);
    expect(rules.isAllowed("/careers")).toBe(true);
    expect(rules.isAllowed("/admin")).toBe(false);
  });

  it("ignores groups for other crawlers", () => {
    const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp");
    expect(rules.isAllowed("/careers")).toBe(true);
    expect(rules.isAllowed("/tmp/x")).toBe(false);
  });

  it("shares rules between consecutive User-agent lines", () => {
    const rules = parseRobots("User-agent: Googlebot\nUser-agent: *\nDisallow: /shared");
    expect(rules.isAllowed("/shared")).toBe(false);
  });

  it("ignores comments, blank lines, CRLF endings and unknown directives", () => {
    const rules = parseRobots("# hello\r\nUser-agent: * # everyone\r\n\r\nHost: example.com\r\nDisallow: /x # no\r\n");
    expect(rules.isAllowed("/x")).toBe(false);
    expect(rules.isAllowed("/y")).toBe(true);
  });

  it("reads sitemaps and caps the crawl delay", () => {
    const rules = parseRobots(
      "Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nCrawl-delay: 2\nDisallow: /x",
    );
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(rules.crawlDelayMs).toBe(2_000);
    expect(parseRobots("User-agent: *\nCrawl-delay: 600").crawlDelayMs).toBe(5_000);
  });

  it("does not choke on an HTML page served in place of robots.txt", () => {
    const rules = parseRobots("<!doctype html><html><head><title>App</title></head><body>hi</body></html>");
    expect(rules.isAllowed("/careers")).toBe(true);
  });
});

const page = (body: string): FetchPageResult => ({
  ok: true,
  url: "",
  status: 200,
  contentType: "text/plain",
  body,
  truncated: false,
  attempts: 1,
});
const failure = (code: "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR", status?: number): FetchPageResult => ({
  ok: false,
  url: "",
  code,
  status,
  message: status ? `HTTP ${status}` : code,
  attempts: 1,
});

// A fake fetchPage that serves robots files by URL and counts requests.
function fakeFetch(files: Record<string, FetchPageResult>) {
  return vi.fn(async (url: string) => files[url] ?? failure("HTTP_ERROR", 404));
}

describe("createRobotsChecker", () => {
  it("allows and disallows according to the origin's robots.txt, with a reason", async () => {
    const fetchPageImpl = fakeFetch({
      "https://acme.test/robots.txt": page("User-agent: *\nDisallow: /internal/"),
    });
    const robots = createRobotsChecker({ allowPrivateHosts: false, fetchPageImpl });

    expect(await robots.isAllowed("https://acme.test/careers")).toEqual({ allowed: true });
    expect(await robots.isAllowed("https://acme.test/internal/hiring?x=1")).toEqual({
      allowed: false,
      reason: "Disallowed by robots.txt",
    });
  });

  it("fetches each robots.txt once, even for concurrent callers", async () => {
    const fetchPageImpl = fakeFetch({ "https://acme.test/robots.txt": page("User-agent: *\nDisallow: /x") });
    const robots = createRobotsChecker({ allowPrivateHosts: false, fetchPageImpl });

    await Promise.all([
      robots.isAllowed("https://acme.test/a"),
      robots.isAllowed("https://acme.test/b"),
      robots.isAllowed("https://acme.test/c"),
    ]);
    expect(fetchPageImpl).toHaveBeenCalledTimes(1);
  });

  it("allows everything when robots.txt is missing (4xx)", async () => {
    const robots = createRobotsChecker({ allowPrivateHosts: false, fetchPageImpl: fakeFetch({}) });
    expect(await robots.isAllowed("https://acme.test/careers")).toEqual({ allowed: true });
  });

  it.each([
    ["a 5xx", failure("HTTP_ERROR", 503)],
    ["a timeout", failure("TIMEOUT")],
    ["a network error", failure("NETWORK_ERROR")],
  ])("disallows everything when robots.txt is unreachable: %s", async (_name, result) => {
    const fetchPageImpl = fakeFetch({ "https://acme.test/robots.txt": result });
    const robots = createRobotsChecker({ allowPrivateHosts: false, fetchPageImpl });
    const decision = await robots.isAllowed("https://acme.test/careers");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/^robots\.txt unreachable/);
  });

  it("passes the fetch options through, and not its own", async () => {
    const fetchPageImpl = fakeFetch({});
    const robots = createRobotsChecker({ allowPrivateHosts: true, timeoutMs: 1234, sitePrefix: "/acme/", fetchPageImpl });
    await robots.isAllowed("http://localhost:8099/acme/careers");
    expect(fetchPageImpl).toHaveBeenCalledWith("http://localhost:8099/robots.txt", {
      allowPrivateHosts: true,
      timeoutMs: 1234,
    });
  });
});

describe("createRobotsChecker — site mounted under a path", () => {
  const origin = "http://localhost:8099";

  it("also honours <prefix>robots.txt, with paths as written or relative to the prefix", async () => {
    const fetchPageImpl = fakeFetch({
      [`${origin}/acme/robots.txt`]: page("User-agent: *\nDisallow: /drafts/\nDisallow: /acme/legal/"),
    });
    const robots = createRobotsChecker({ allowPrivateHosts: true, sitePrefix: "/acme", fetchPageImpl });

    expect(await robots.isAllowed(`${origin}/acme/careers`)).toEqual({ allowed: true });
    expect(await robots.isAllowed(`${origin}/acme/drafts/hiring`)).toEqual({
      allowed: false,
      reason: "Disallowed by /acme/robots.txt",
    });
    expect((await robots.isAllowed(`${origin}/acme/legal/terms`)).allowed).toBe(false);
  });

  it("still applies the origin's robots.txt first", async () => {
    const fetchPageImpl = fakeFetch({
      [`${origin}/robots.txt`]: page("User-agent: *\nDisallow: /acme/secret"),
    });
    const robots = createRobotsChecker({ allowPrivateHosts: true, sitePrefix: "/acme/", fetchPageImpl });
    expect(await robots.isAllowed(`${origin}/acme/secret`)).toEqual({
      allowed: false,
      reason: "Disallowed by robots.txt",
    });
  });

  it("does not consult the prefix file for URLs outside the prefix", async () => {
    const fetchPageImpl = fakeFetch({});
    const robots = createRobotsChecker({ allowPrivateHosts: true, sitePrefix: "/acme/", fetchPageImpl });
    await robots.isAllowed(`${origin}/globex/careers`);
    expect(fetchPageImpl).toHaveBeenCalledTimes(1);
  });
});
