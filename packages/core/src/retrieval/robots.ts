import { USER_AGENT, fetchPage } from "./fetch-page";
import type { FetchPageOptions, FetchPageResult } from "./fetch-page";

// robots.txt, following RFC 9309: groups are chosen by user-agent, the longest matching
// rule wins, and Allow wins a tie.

export const PRODUCT_TOKEN = USER_AGENT.split("/")[0]!.toLowerCase();
const MAX_CRAWL_DELAY_MS = 5_000;

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export interface RobotsRules {
  /** `path` is the URL's pathname plus query string. */
  isAllowed(path: string): boolean;
  crawlDelayMs?: number;
  sitemaps: string[];
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true, sitemaps: [] };
const DISALLOW_ALL: RobotsRules = { isAllowed: () => false, sitemaps: [] };

// `*` matches any run of characters, a trailing `$` anchors the end; everything else is literal.
function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function parseRobots(text: string, productToken = PRODUCT_TOKEN): RobotsRules {
  const groups: { agents: string[]; rules: Rule[]; crawlDelayMs?: number }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      // Consecutive User-agent lines share one group; one after rules starts a new group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else if (current && (key === "allow" || key === "disallow")) {
      // An empty Disallow means "nothing is disallowed", so it adds no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value, regex: toRegex(value) });
    } else if (current && key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        current.crawlDelayMs = Math.min(seconds * 1000, MAX_CRAWL_DELAY_MS);
      }
    }
  }

  // Groups naming us beat the wildcard group; several groups for the same agent are merged.
  const named = groups.filter((g) => g.agents.includes(productToken.toLowerCase()));
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const crawlDelayMs = chosen.find((g) => g.crawlDelayMs !== undefined)?.crawlDelayMs;

  return {
    sitemaps,
    crawlDelayMs,
    isAllowed(path) {
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        const longer = !best || rule.pattern.length > best.pattern.length;
        const tieToAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
        if (longer || tieToAllow) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}

export interface RobotsDecision {
  allowed: boolean;
  /** Set when disallowed, ready to go into the research log. */
  reason?: string;
  /** Disallowed because robots.txt could not be reached, which usually means the site is down. */
  unreachable?: boolean;
}

export interface RobotsCheckerOptions extends FetchPageOptions {
  /**
   * For a site mounted under a path (`http://localhost:8099/acme/`), a second robots.txt
   * is also read from `<sitePrefix>robots.txt`. This is not in the standard, which only
   * looks at the origin root; it is here because a server hosting several sites under one
   * origin has nowhere else to put per-site rules. Its paths are honoured both as written
   * and relative to the prefix, and a URL must pass both files.
   */
  sitePrefix?: string;
  /** Injected in tests. */
  fetchPageImpl?: typeof fetchPage;
}

export interface RobotsChecker {
  isAllowed(url: string): Promise<RobotsDecision>;
  rulesFor(origin: string): Promise<RobotsRules>;
}

function rulesFromResponse(result: FetchPageResult): { rules: RobotsRules; unreachable?: string } {
  if (result.ok) return { rules: parseRobots(result.body) };
  // RFC 9309: "unavailable" (4xx) means no restrictions; "unreachable" (5xx, network
  // failure, timeout) means assume everything is disallowed.
  const unreachable =
    result.code === "TIMEOUT" ||
    result.code === "NETWORK_ERROR" ||
    (result.code === "HTTP_ERROR" && (result.status ?? 0) >= 500);
  return unreachable
    ? { rules: DISALLOW_ALL, unreachable: result.message }
    : { rules: ALLOW_ALL };
}

export function createRobotsChecker(options: RobotsCheckerOptions): RobotsChecker {
  const { sitePrefix, fetchPageImpl = fetchPage, ...fetchOptions } = options;
  const prefix = sitePrefix && sitePrefix !== "/" ? sitePrefix.replace(/\/?$/, "/") : undefined;
  const cache = new Map<string, Promise<{ rules: RobotsRules; unreachable?: string }>>();

  // The promise is cached, so concurrent callers share one request per robots.txt.
  const load = (robotsUrl: string) => {
    let entry = cache.get(robotsUrl);
    if (!entry) {
      entry = fetchPageImpl(robotsUrl, fetchOptions).then(rulesFromResponse);
      cache.set(robotsUrl, entry);
    }
    return entry;
  };

  return {
    async rulesFor(origin) {
      return (await load(`${origin}/robots.txt`)).rules;
    },

    async isAllowed(rawUrl) {
      const url = new URL(rawUrl);
      const path = url.pathname + url.search;

      const root = await load(`${url.origin}/robots.txt`);
      if (root.unreachable) {
        return { allowed: false, unreachable: true, reason: `robots.txt unreachable (${root.unreachable})` };
      }
      if (!root.rules.isAllowed(path)) {
        return { allowed: false, reason: "Disallowed by robots.txt" };
      }

      if (prefix && url.pathname.startsWith(prefix)) {
        const site = await load(`${url.origin}${prefix}robots.txt`);
        const relative = `/${path.slice(prefix.length)}`;
        if (!site.unreachable && !(site.rules.isAllowed(path) && site.rules.isAllowed(relative))) {
          return { allowed: false, reason: `Disallowed by ${prefix}robots.txt` };
        }
      }
      return { allowed: true };
    },
  };
}
