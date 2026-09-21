import type { ResearchLogEntry } from "../schema/kit";
import { cleanHtml } from "./clean-html";
import { fetchPage } from "./fetch-page";
import type { FetchPageOptions } from "./fetch-page";
import { createRobotsChecker } from "./robots";
import { assessHiringContent, rankLinks } from "./score-links";
import type { HiringAssessment, ScoredLink } from "./score-links";
import { parseHttpUrl } from "./url-guard";

// Best-first crawl of one company site: fetch the page most likely to be useful, read its
// links, repeat until the budget runs out. Nothing here throws for a bad site — what could
// not be fetched is written to the log and the crawl carries on.

export const DEFAULT_MAX_PAGES = 8;
export const DEFAULT_MAX_DEPTH = 3;
export const DEFAULT_POLITENESS_MS = 1_000;
const MAX_OUT_OF_PREFIX_TRIES = 2;
const MIN_USEFUL_TEXT_CHARS = 50;
const DEPTH_PENALTY = 2;

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  kind: "home" | "hiring" | "about";
  depth: number;
  hiring: HiringAssessment;
}

export interface CrawlResult {
  /** False when the company URL itself could not be fetched. */
  reachable: boolean;
  /** From page metadata or titles. Empty when unknown — never taken from the hostname. */
  companyName: string;
  pages: CrawledPage[];
  hiringPage?: CrawledPage;
  log: ResearchLogEntry[];
}

export interface CrawlOptions extends FetchPageOptions {
  maxPages?: number;
  maxDepth?: number;
  /** Minimum gap between requests to the site. Loopback hosts are exempt. */
  politenessMs?: number;
  /** Checked before each request, so a kit that is out of time stops crawling. */
  shouldStop?: () => boolean;
  fetchPageImpl?: typeof fetchPage;
}

interface Candidate {
  url: string;
  depth: number;
  priority: number;
}

const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]";

// `/acme/` and `/acme` both mean the site lives under /acme/; `/acme/index.html` does too.
function sitePrefixOf(seed: URL): string | undefined {
  const path = seed.pathname;
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  const directory = path.endsWith("/")
    ? path
    : lastSegment.includes(".")
      ? path.slice(0, path.lastIndexOf("/") + 1)
      : `${path}/`;
  return directory === "/" ? undefined : directory;
}

// One key per page, so /careers, /careers/ and /careers#team are fetched once.
function pageKey(raw: string): string {
  const url = new URL(raw);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

const GENERIC_TITLE_PARTS = /^(home|homepage|welcome|about( us)?|careers?|jobs?|blog|contact|team|company|products?)$/i;

// The part of the title that repeats across pages ("About | Acme", "Careers | Acme") is the name.
function nameFromTitles(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const parts = title.split(/\s+[|–—·:-]\s+/).map((p) => p.trim());
    for (const part of new Set(parts)) {
      if (part && !GENERIC_TITLE_PARTS.test(part)) counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  return best && (best[1] >= 2 || titles.length === 1) ? best[0] : "";
}

export async function crawlSite(companyUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const {
    maxPages = DEFAULT_MAX_PAGES,
    maxDepth = DEFAULT_MAX_DEPTH,
    politenessMs = DEFAULT_POLITENESS_MS,
    shouldStop = () => false,
    fetchPageImpl = fetchPage,
    ...fetchOptions
  } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const log: ResearchLogEntry[] = [];
  const record = (url: string | null, outcome: ResearchLogEntry["outcome"], reason: string | null, step = "crawl") =>
    log.push({ step, url, outcome, reason });
  const result: CrawlResult = { reachable: false, companyName: "", pages: [], log };

  const parsed = parseHttpUrl(companyUrl);
  if (!parsed.ok) {
    record(companyUrl || null, "failed", parsed.message);
    return result;
  }
  const seed = parsed.url;
  seed.hash = "";
  const prefix = sitePrefixOf(seed);
  const inScope = (url: URL) => url.origin === seed.origin && (!prefix || url.pathname.startsWith(prefix));

  const robots = createRobotsChecker({ ...fetchOptions, fetchPageImpl, sitePrefix: prefix });
  const gapMs = isLoopback(seed.hostname) ? 0 : politenessMs;
  const seen = new Set<string>();
  const queue: Candidate[] = [{ url: seed.href, depth: 0, priority: Number.POSITIVE_INFINITY }];
  const outsidePrefix: ScoredLink[] = [];
  const titles: string[] = [];
  let siteName = "";
  let requests = 0;

  /** Robots check, pacing, fetch, clean. Returns nothing when the page was skipped or failed. */
  const visit = async (url: string, depth: number) => {
    const decision = await robots.isAllowed(url);
    if (!decision.allowed) {
      // An unreachable robots.txt means the site is down, which is a failure, not a choice.
      record(url, decision.unreachable ? "failed" : "skipped", decision.reason ?? "Disallowed by robots.txt");
      return undefined;
    }
    if (requests > 0 && gapMs > 0) await sleep(gapMs);
    requests += 1;

    const fetched = await fetchPageImpl(url, fetchOptions);
    if (!fetched.ok) {
      record(url, "failed", `${fetched.code}: ${fetched.message}`);
      return undefined;
    }
    seen.add(pageKey(fetched.url));

    const cleaned = cleanHtml(fetched.body, fetched.url);
    if (cleaned.text.length < MIN_USEFUL_TEXT_CHARS) {
      record(fetched.url, "empty", "Page had no readable text");
      return { cleaned, page: undefined };
    }
    const hiring = assessHiringContent(cleaned);
    const page: CrawledPage = {
      url: fetched.url,
      title: cleaned.title,
      text: cleaned.text,
      truncated: cleaned.truncated || fetched.truncated,
      kind: depth === 0 ? "home" : hiring.isHiringPage ? "hiring" : "about",
      depth,
      hiring,
    };
    return { cleaned, page };
  };

  while (queue.length > 0 && result.pages.length < maxPages && requests < maxPages * 2) {
    if (shouldStop()) {
      record(null, "skipped", "Stopped crawling: out of time");
      break;
    }
    queue.sort((a, b) => b.priority - a.priority);
    const next = queue.shift()!;
    if (seen.has(pageKey(next.url))) continue;
    seen.add(pageKey(next.url));

    const visited = await visit(next.url, next.depth);
    if (next.depth === 0) result.reachable = Boolean(visited);
    if (!visited) {
      if (next.depth === 0) return result;
      continue;
    }

    const { cleaned, page } = visited;
    if (page) {
      result.pages.push(page);
      titles.push(cleaned.title);
      siteName ||= cleaned.siteName;
      record(page.url, "ok", page.kind === "hiring" ? "Hiring page" : null);
    }

    // A redirect can land outside the site; its links are not ours to follow.
    if (next.depth >= maxDepth || !inScope(new URL(cleaned.url))) continue;
    for (const link of rankLinks(cleaned.links)) {
      const target = new URL(link.url);
      if (seen.has(pageKey(link.url))) continue;
      if (inScope(target)) {
        queue.push({ url: link.url, depth: next.depth + 1, priority: link.score - DEPTH_PENALTY * (next.depth + 1) });
      } else if (target.origin === seed.origin && link.kind === "hiring") {
        outsidePrefix.push(link);
      }
    }
  }

  const bestHiring = () =>
    result.pages
      .filter((p) => p.kind === "hiring")
      .sort((a, b) => Number(b.hiring.describesProcess) - Number(a.hiring.describesProcess) || b.hiring.score - a.hiring.score)[0];

  // The site folder had nothing on hiring. Links its own pages made to the rest of the
  // origin get one hop: fetched, never expanded, and kept only if they really are a hiring
  // page for this company — a shared origin can host other companies.
  // Without a known company name there is no way to tell whose page it is, so none are tried.
  const knownName = (siteName || nameFromTitles(titles)).toLowerCase();
  if (!bestHiring() && result.reachable && knownName) {
    const tries = outsidePrefix.sort((a, b) => b.score - a.score).slice(0, MAX_OUT_OF_PREFIX_TRIES);
    for (const link of tries) {
      if (shouldStop() || result.pages.length >= maxPages || seen.has(pageKey(link.url))) continue;
      seen.add(pageKey(link.url));
      const visited = await visit(link.url, 1);
      if (!visited?.page) continue;
      const { cleaned } = visited;
      const sameCompany =
        cleaned.siteName.toLowerCase() === knownName || cleaned.title.toLowerCase().includes(knownName);
      if (visited.page.kind !== "hiring" || !sameCompany) {
        record(visited.page.url, "skipped", sameCompany ? "Not a hiring page" : "Belongs to a different site");
        continue;
      }
      result.pages.push(visited.page);
      record(visited.page.url, "ok", "Hiring page");
    }
  }

  result.companyName = siteName || nameFromTitles(titles);
  result.hiringPage = bestHiring();
  if (result.hiringPage) {
    const detail = result.hiringPage.hiring.describesProcess
      ? "Describes the interview process"
      : "Careers page; does not describe the interview process";
    record(result.hiringPage.url, "ok", detail, "hiring_page");
  } else {
    record(null, "empty", "No hiring page found on the company site", "hiring_page");
  }
  return result;
}
