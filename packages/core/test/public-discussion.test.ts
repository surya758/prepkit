import { describe, expect, it, vi } from "vitest";
import { findPublicDiscussion, publicDiscussionSchema } from "../src";

interface Hit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  created_at?: string;
}

// The tests run at a fixed moment, so "recent" and "too old" never drift.
const NOW = Date.parse("2026-09-21T00:00:00Z");
const RECENT = "2025-06-01T12:00:00Z";

/** A fake search API: records the URL it was asked for and returns the scripted hits. */
function network(hits: Hit[] | Error | Response) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request) => {
    if (hits instanceof Error) throw hits;
    if (hits instanceof Response) return hits;
    return new Response(JSON.stringify({ hits }), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl.mock.calls, now: () => NOW };
}

const comment = (objectID: string, comment_text: string, story_title = "Ask HN: Who is hiring?", created_at = RECENT): Hit => ({
  objectID,
  comment_text,
  story_title,
  created_at,
});

describe("findPublicDiscussion — the search", () => {
  it("searches Hacker News for the quoted company name plus 'interview'", async () => {
    const net = network([]);
    const { discussion } = await findPublicDiscussion("Acme Logistics", net);

    const url = new URL(String(net.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://hn.algolia.com/api/v1/search");
    expect(url.searchParams.get("query")).toBe('"Acme Logistics" interview');
    expect(url.searchParams.get("tags")).toBe("(story,comment)");
    expect(discussion).toMatchObject({ searched: true, source: "Hacker News", query: '"Acme Logistics" interview' });
  });

  it("does not search when the company's name is unknown", async () => {
    const net = network([]);
    const result = await findPublicDiscussion("  ", net);

    expect(net.calls).toHaveLength(0);
    expect(result.discussion).toEqual({ searched: false, source: "Hacker News", query: "", hits: [] });
    expect(result.log).toEqual([
      { step: "public_discussion", url: null, outcome: "skipped", reason: "The company's name is not known, so there was nothing to search for" },
    ]);
  });
});

describe("findPublicDiscussion — what counts as relevant", () => {
  it("keeps a comment that names the company next to talk about being interviewed", async () => {
    const net = network([
      comment("41000001", "I interviewed at Stripe last year. The interview process was a phone screen, then a take-home, then an onsite with a system design round."),
    ]);
    const { discussion, log } = await findPublicDiscussion("Stripe", net);

    expect(discussion.hits).toEqual([
      {
        title: "Ask HN: Who is hiring?",
        url: "https://news.ycombinator.com/item?id=41000001",
        excerpt: expect.stringContaining("interviewed at Stripe"),
        posted_at: "2025-06-01T12:00:00.000Z",
      },
    ]);
    expect(publicDiscussionSchema.safeParse(discussion).success).toBe(true);
    expect(log[0]).toMatchObject({ outcome: "ok", reason: "1 relevant discussion(s) from the last 5 years found out of 1 search result(s)" });
  });

  it("rejects a media interview: the word 'interview' alone is not hiring talk", async () => {
    const net = network([{ objectID: "3545559", title: "Co-Founder of Stripe [YC] Interviewed in Depth (Audio)", created_at: RECENT }]);
    expect((await findPublicDiscussion("Stripe", net)).discussion.hits).toEqual([]);
  });

  // The next three are real results the first version let through for "Acme" and "GitLab".
  it("rejects 'an interview with…': that is how media and user interviews are described", async () => {
    const net = network([{ objectID: "23981985", title: "A new funding model", comment_text: "Have a look at Sid of GitLab interview with Joe Jacks", created_at: RECENT }]);
    expect((await findPublicDiscussion("GitLab", net)).discussion.hits).toEqual([]);
  });

  it("does not take an email address or a domain for the company", async () => {
    const net = network([comment("41441233", "If I had an interview process question from user John@acme.com, or a link to careers.acme.io, I would log it.")]);
    expect((await findPublicDiscussion("Acme", net)).discussion.hits).toEqual([]);
  });

  it("does not take 'Acme Packet' for 'Acme', but does accept 'Acme Inc'", async () => {
    const other = network([comment("2838006", "The interview process at Acme Packet was a phone screen and an onsite.")]);
    expect((await findPublicDiscussion("Acme", other)).discussion.hits).toEqual([]);

    const same = network([comment("2838007", "The interview process at Acme Inc was a phone screen and an onsite.")]);
    expect((await findPublicDiscussion("Acme", same)).discussion.hits).toHaveLength(1);
  });

  it("rejects a thread where the company and the hiring talk are far apart", async () => {
    const filler = "Unrelated discussion about databases and deployment pipelines. ".repeat(12);
    const net = network([comment("41000002", `Acme ships a nice product. ${filler} Separately, my interview process at another company had a take-home.`)]);
    expect((await findPublicDiscussion("Acme", net)).discussion.hits).toEqual([]);
  });

  it("matches the company as a whole word only", async () => {
    const net = network([comment("41000003", "The interview process at Acmeology was a take-home and an onsite.")]);
    expect((await findPublicDiscussion("Acme", net)).discussion.hits).toEqual([]);
  });

  it("treats regex characters in a company name literally", async () => {
    const net = network([comment("41000004", "My interview experience with C++ Corp (really) was a phone screen and a whiteboard round.")]);
    const { discussion } = await findPublicDiscussion("C++ Corp (really)", net);
    // No crash, and no false match from the pattern being read as a regex.
    expect(discussion.searched).toBe(true);
  });

  it("strips HTML and entities from comments, and keeps the excerpt short", async () => {
    const net = network([comment("41000005", `<p>My <i>interview experience</i> at Globex wasn&#x27;t bad: a recruiter call &amp; a take-home.</p>${" padding".repeat(200)}`)]);
    const { discussion } = await findPublicDiscussion("Globex", net);

    expect(discussion.hits[0]!.excerpt).toContain("at Globex wasn't bad: a recruiter call & a take-home.");
    expect(discussion.hits[0]!.excerpt).not.toContain("<");
    expect(discussion.hits[0]!.excerpt.length).toBeLessThanOrEqual(282);
  });

  it("builds the link from the numeric id, and ignores hits without one", async () => {
    const net = network([
      { objectID: "javascript:alert(1)", comment_text: "The interview process at Acme was a take-home.", created_at: RECENT },
      comment("41000006", "The interview process at Acme was a take-home."),
    ]);
    const { discussion } = await findPublicDiscussion("Acme", net);
    expect(discussion.hits.map((h) => h.url)).toEqual(["https://news.ycombinator.com/item?id=41000006"]);
  });

  it("treats the same paragraph pasted into two threads as one hit", async () => {
    const boilerplate = "Here is our full list of vacancies. Here is an inside look at the interview process at Acme, which has a take-home and then four more conversations with the team";
    const net = network([comment("41000010", `${boilerplate}. Posted in March.`), comment("41000011", `${boilerplate}. Posted in April, reposted.`)]);
    expect((await findPublicDiscussion("Acme", net)).discussion.hits).toHaveLength(1);
  });

  it("keeps at most five, and drops repeats", async () => {
    const same = "The interview process at Acme was a take-home and an onsite.";
    const distinct = Array.from({ length: 9 }, (_, i) => comment(String(42000000 + i), `Story ${i}: the interview process at Acme had ${i} rounds and a take-home.`));
    const net = network([comment("41000007", same), comment("41000008", same), ...distinct]);
    const { discussion } = await findPublicDiscussion("Acme", net);

    expect(discussion.hits).toHaveLength(5);
    expect(discussion.hits.filter((h) => h.excerpt.includes("was a take-home and an onsite"))).toHaveLength(1);
  });
});

describe("findPublicDiscussion — recency", () => {
  const talk = (company: string, n: number) => `Account ${n}: the interview process at ${company} was a phone screen and a take-home.`;

  it("asks the search API only for the last five years", async () => {
    const net = network([]);
    await findPublicDiscussion("Stripe", net);
    const filter = new URL(String(net.calls[0]![0])).searchParams.get("numericFilters");
    expect(filter).toBe(`created_at_i>${Math.floor((NOW - 5 * 365.25 * 24 * 60 * 60 * 1000) / 1000)}`);
  });

  it("drops an old account even if the API returns it anyway, and says so", async () => {
    const net = network([comment("7193950", talk("Stripe", 1), "Stripe interview experience", "2014-02-07T00:29:27Z")]);
    const { discussion, log } = await findPublicDiscussion("Stripe", net);

    expect(discussion.hits).toEqual([]);
    expect(log[0]!.reason).toBe(
      "No public discussion of Stripe's interview process from the last 5 years was found (1 search result(s), none relevant, 1 too old)",
    );
  });

  it("puts the newest accounts first, and applies the limit of five after sorting", async () => {
    const years = [2022, 2026, 2023, 2025, 2024, 2022, 2023];
    const net = network(years.map((year, i) => comment(String(43000000 + i), talk("Stripe", i), "Thread", `${year}-0${(i % 8) + 1}-15T00:00:00Z`)));
    const { discussion } = await findPublicDiscussion("Stripe", net);

    expect(discussion.hits).toHaveLength(5);
    expect(discussion.hits.map((h) => h.posted_at.slice(0, 4))).toEqual(["2026", "2025", "2024", "2023", "2023"]);
  });

  it("ignores a hit with no usable date rather than guessing how old it is", async () => {
    const undated: Hit = { objectID: "44000001", comment_text: talk("Stripe", 1) };
    const garbled = comment("44000002", talk("Stripe", 2), "Thread", "last Tuesday");
    expect((await findPublicDiscussion("Stripe", network([undated, garbled]))).discussion.hits).toEqual([]);
  });
});

describe("findPublicDiscussion — honest about finding nothing", () => {
  it("reports an empty result, which is the normal case for most companies", async () => {
    const net = network([{ objectID: "1", title: "Show HN: a thing unrelated to anything", created_at: RECENT }]);
    const { discussion, log } = await findPublicDiscussion("Initech", net);

    expect(discussion).toMatchObject({ searched: true, hits: [] });
    expect(log).toEqual([
      expect.objectContaining({
        step: "public_discussion",
        outcome: "empty",
        reason: "No public discussion of Initech's interview process from the last 5 years was found (1 search result(s), none relevant)",
      }),
    ]);
  });

  it.each([
    ["the network is down", new TypeError("fetch failed"), "could not be reached: fetch failed"],
    ["the API answers 503", new Response("", { status: 503 }), "answered HTTP 503"],
    ["the API answers with something that is not JSON", new Response("<html>oops</html>", { status: 200 }), "could not be reached"],
  ])("never throws when %s: it records the failure and says it did not search", async (_name, outcome, reason) => {
    const result = await findPublicDiscussion("Acme", network(outcome));
    expect(result.discussion).toMatchObject({ searched: false, hits: [] });
    expect(result.log[0]).toMatchObject({ step: "public_discussion", outcome: "failed" });
    expect(result.log[0]!.reason).toContain(reason);
  });

  it("tolerates a response with no hits field", async () => {
    const result = await findPublicDiscussion("Acme", network(new Response(JSON.stringify({ message: "ok" }), { status: 200 })));
    expect(result.discussion).toMatchObject({ searched: true, hits: [] });
  });
});
