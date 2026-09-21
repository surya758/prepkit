import type { PublicDiscussion, ResearchLogEntry } from "../schema/kit";

// "Look for public discussion of how the company interviews." The source has to work from a
// clean clone with no extra key, which rules out the search APIs and the review sites (which
// block automated access anyway). Hacker News is public, has a free keyless search API
// (hn.algolia.com), and is where engineers tend to describe interview loops.
//
// For most companies there will be nothing, and saying so is the correct result.

const STEP = "public_discussion";
const SEARCH_URL = "https://hn.algolia.com/api/v1/search";
export const DEFAULT_DISCUSSION_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const HITS_TO_FETCH = 30;
const MAX_HITS_KEPT = 5;
const PROXIMITY_CHARS = 300;
const EXCERPT_CHARS = 280;
const DUPLICATE_PREFIX_CHARS = 120;
// Interview processes change. A 2013 account of a company's loop is history, not preparation.
export const MAX_DISCUSSION_AGE_YEARS = 5;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// "Interview" alone matches "founder interviewed in depth", so the wording has to be about
// being hired, not about being in the news.
const HIRING_TALK =
  /\b(interview(ed|ing)? (at|for)|interview (process|experience|questions?|loop|rounds?|stages?|prep)|my interviews?|hiring (process|bar|loop)|take[- ]?home|on-?site|phone screen|technical screen|recruiter|got (an|the) offer|offer stage|coding (challenge|test|exercise)|system design (round|interview)|whiteboard)\b/i;
// Deliberately absent: "interview with". "An interview with the founder of X" and "a user
// interview with someone@x.com" are the commonest false matches in real search results.

// A capitalised word straight after the name usually means a different company ("Acme Packet"),
// unless it is one of these.
const SAME_COMPANY_SUFFIX = /^(Inc|Corp|Corporation|Ltd|LLC|GmbH|Labs|Technologies|Software|HQ|Engineering)\b/;

interface AlgoliaHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  created_at?: string;
}

export interface DiscussionResult {
  discussion: PublicDiscussion;
  log: ResearchLogEntry[];
}

export interface DiscussionOptions {
  timeoutMs?: number;
  /** Injected in tests, so no test ever touches the network. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The company must be named as a whole word, on its own, with hiring talk close by. Proximity is what
 * keeps a common name ("Acme", "Notion") from matching any thread that mentions interviews.
 */
function relevantExcerpt(text: string, company: string): string | undefined {
  // Not part of an email address, a domain or a longer word: "john@acme.com" is not the company.
  const name = new RegExp(`(?<![@.\\w-])${escapeRegex(company)}(?![\\w-]|\\.[a-z]{2,})`, "gi");
  for (const match of text.matchAll(name)) {
    const after = text.slice(match.index + company.length);
    const nextWord = /^ ([A-Z][a-z]+)/.exec(after)?.[1];
    if (nextWord && !SAME_COMPANY_SUFFIX.test(nextWord)) continue;

    const start = Math.max(0, match.index - PROXIMITY_CHARS);
    const window = text.slice(start, match.index + company.length + PROXIMITY_CHARS);
    if (HIRING_TALK.test(window)) {
      const from = Math.max(0, match.index - EXCERPT_CHARS / 2);
      const excerpt = text.slice(from, from + EXCERPT_CHARS).trim();
      return `${from > 0 ? "…" : ""}${excerpt}${from + EXCERPT_CHARS < text.length ? "…" : ""}`;
    }
  }
  return undefined;
}

const nothing = (searched: boolean, query = ""): PublicDiscussion => ({ searched, source: "Hacker News", query, hits: [] });

/** Never throws: a search that fails is a log entry, not a failed kit. */
export async function findPublicDiscussion(companyName: string, options: DiscussionOptions = {}): Promise<DiscussionResult> {
  const company = companyName.trim();
  if (company.length < 2) {
    return {
      discussion: nothing(false),
      log: [{ step: STEP, url: null, outcome: "skipped", reason: "The company's name is not known, so there was nothing to search for" }],
    };
  }

  const query = `"${company}" interview`;
  const cutoff = (options.now ?? Date.now)() - MAX_DISCUSSION_AGE_YEARS * YEAR_MS;
  const url = `${SEARCH_URL}?${new URLSearchParams({
    query,
    tags: "(story,comment)",
    hitsPerPage: String(HITS_TO_FETCH),
    // Asked of the API, and checked again below in case it is ignored.
    numericFilters: `created_at_i>${Math.floor(cutoff / 1000)}`,
  })}`;
  const failed = (reason: string): DiscussionResult => ({
    discussion: nothing(false, query),
    log: [{ step: STEP, url, outcome: "failed", reason }],
  });

  let hits: AlgoliaHit[];
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_DISCUSSION_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return failed(`Hacker News search answered HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) return failed("Hacker News search response was unexpectedly large");
    const parsed = JSON.parse(body) as { hits?: unknown };
    hits = Array.isArray(parsed.hits) ? (parsed.hits as AlgoliaHit[]) : [];
  } catch (error) {
    return failed(`Hacker News search could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }

  const kept: PublicDiscussion["hits"] = [];
  const seen = new Set<string>();
  let tooOld = 0;
  for (const hit of hits) {
    if (!hit.objectID || !/^\d+$/.test(hit.objectID)) continue;
    const postedAt = Date.parse(hit.created_at ?? "");
    if (!Number.isFinite(postedAt)) continue;
    if (postedAt < cutoff) {
      tooOld += 1;
      continue;
    }
    const title = plain(hit.title ?? hit.story_title ?? "");
    const excerpt = relevantExcerpt(plain(`${title}. ${hit.comment_text ?? hit.story_text ?? ""}`), company);
    // Recruiters paste the same paragraph into many threads, so near-identical openings are one hit.
    const fingerprint = excerpt?.slice(0, DUPLICATE_PREFIX_CHARS).toLowerCase();
    if (!excerpt || !fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    kept.push({
      title: title || "Hacker News comment",
      // Built from the numeric id, never taken from the response, so a hit cannot point anywhere else.
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      excerpt,
      posted_at: new Date(postedAt).toISOString(),
    });
  }
  // Newest first, then the limit: five recent accounts beat five well-ranked old ones.
  kept.sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  kept.length = Math.min(kept.length, MAX_HITS_KEPT);

  return {
    discussion: { searched: true, source: "Hacker News", query, hits: kept },
    log: [
      kept.length > 0
        ? { step: STEP, url, outcome: "ok", reason: `${kept.length} relevant discussion(s) from the last ${MAX_DISCUSSION_AGE_YEARS} years found out of ${hits.length} search result(s)` }
        : { step: STEP, url, outcome: "empty", reason: `No public discussion of ${company}'s interview process from the last ${MAX_DISCUSSION_AGE_YEARS} years was found (${hits.length} search result(s), none relevant${tooOld ? `, ${tooOld} too old` : ""})` },
    ],
  };
}
