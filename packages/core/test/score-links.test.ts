import { describe, expect, it } from "vitest";
import { assessHiringContent, rankLinks, scoreLink } from "../src";
import type { PageLink } from "../src";

const BASE = "http://localhost:8099/acme";
const link = (path: string, text: string, inNav = false): PageLink => ({ url: `${BASE}${path}`, text, inNav });

describe("scoreLink — hiring pages", () => {
  it.each([
    ["/careers", "Careers"],
    ["/jobs", "Open roles"],
    ["/company/work-with-us", "Work with us"],
    // Paths nobody would put in a fixed list: the anchor text carries them.
    ["/handbook/join-the-crew", "Join the crew"],
    ["/handbook/people/how-we-hire", "How we hire"],
    ["/x/7f3a", "Our interview process"],
    // And the reverse: a bare icon link whose path is the only clue.
    ["/handbook/hiring/interviewing/", ""],
  ])("classifies %s (%j) as hiring", (path, text) => {
    const scored = scoreLink(link(path, text));
    expect(scored.kind).toBe("hiring");
    expect(scored.score).toBeGreaterThan(0);
  });

  it("rates a page about the interview process above a generic careers page", () => {
    const process = scoreLink(link("/handbook/people/how-we-hire", "How we hire"));
    const careers = scoreLink(link("/careers", "Careers"));
    expect(process.score).toBeGreaterThan(careers.score);
  });

  it("records which signals fired", () => {
    expect(scoreLink(link("/handbook/join-the-crew", "Join the crew")).signals).toEqual([
      "text:join the",
      "path:join",
      "path:handbook",
    ]);
  });
});

describe("scoreLink — about pages", () => {
  it.each([
    ["/about", "About us"],
    ["/company", "Company"],
    ["/handbook/", "Handbook"],
    ["/product", "Product"],
    ["/engineering-blog", "Engineering"],
  ])("classifies %s (%j) as about", (path, text) => {
    expect(scoreLink(link(path, text)).kind).toBe("about");
  });
});

describe("scoreLink — not worth fetching", () => {
  it.each([
    ["/privacy", "Privacy policy"],
    ["/legal/terms", "Terms"],
    ["/login", "Log in"],
    ["/newsletter", "Join our newsletter"],
    ["/files/careers-brochure.pdf", "Careers brochure"],
    ["/assets/team.png", "Team"],
    ["/pricing", "Pricing"],
    ["/x/7f3a", ""],
  ])("classifies %s (%j) as other", (path, text) => {
    const scored = scoreLink(link(path, text));
    expect(scored.kind).toBe("other");
    expect(scored.score).toBeLessThanOrEqual(0);
  });
});

describe("rankLinks", () => {
  it("orders best first and drops links that are not worth a request", () => {
    const ranked = rankLinks([
      link("/privacy", "Privacy"),
      link("/about", "About"),
      link("/careers", "Careers", true),
      link("/pricing", "Pricing"),
      link("/handbook/people/how-we-hire", "How we hire"),
    ]);
    expect(ranked.map((l) => l.url.replace(BASE, ""))).toEqual([
      "/handbook/people/how-we-hire",
      "/careers",
      "/about",
    ]);
  });

  it("breaks ties in favour of the shorter URL", () => {
    const ranked = rankLinks([link("/careers/berlin", "Careers"), link("/careers", "Careers")]);
    expect(ranked[0]!.url).toBe(`${BASE}/careers`);
  });
});

describe("assessHiringContent", () => {
  it("recognises a page that lays out the interview stages", () => {
    const assessment = assessHiringContent({
      title: "How we hire | Acme",
      text: [
        "## How we hire",
        "Every candidate starts with a 30 minute intro call with a recruiter.",
        "Next is a take-home exercise, which we review together.",
        "The final round is a system design interview and a values interview.",
      ].join("\n"),
    });
    expect(assessment).toMatchObject({ isHiringPage: true, describesProcess: true });
    expect(assessment.signals).toEqual(
      expect.arrayContaining(["stage:take home", "stage:system design", "stage:intro call"]),
    );
  });

  it("recognises a careers page that lists openings but says nothing about the process", () => {
    const assessment = assessHiringContent({
      title: "Careers at Acme",
      text: "We're hiring! See our open roles below and apply today. Applicants hear back within a week.",
    });
    expect(assessment).toMatchObject({ isHiringPage: true, describesProcess: false });
  });

  it("does not mistake an ordinary page for a hiring page", () => {
    const assessment = assessHiringContent({
      title: "About Acme",
      text: "Acme builds route planning software for mid-size retailers. We are 40 people, fully remote.",
    });
    expect(assessment).toMatchObject({ isHiringPage: false, describesProcess: false, score: 0 });
  });

  it("is not fooled by a single passing mention", () => {
    const assessment = assessHiringContent({
      title: "Engineering blog",
      text: "In this post we interview our head of platform about the migration to Postgres.",
    });
    expect(assessment.isHiringPage).toBe(false);
  });

  it("handles hyphenated and unhyphenated spellings alike", () => {
    const hyphenated = assessHiringContent({ title: "", text: "A take-home task, then an on-site day." });
    const spaced = assessHiringContent({ title: "", text: "A take home task, then an onsite day." });
    expect(hyphenated.describesProcess).toBe(true);
    expect(spaced.describesProcess).toBe(true);
  });
});
