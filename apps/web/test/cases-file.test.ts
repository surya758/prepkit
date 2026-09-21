import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_ROLES_PER_FILE, parseCasesFile } from "@/lib/cases-file";

const file = (value: unknown) => JSON.stringify(value);
const role = (n: number) => ({ id: `case-${n}`, jd: `Engineer ${n}\n- TypeScript`, company_url: `https://company${n}.example/`, days: 5 });
const messageOf = (text: string) => {
  const result = parseCasesFile(text);
  return result.ok ? "ok" : result.message;
};

describe("parseCasesFile — a usable file", () => {
  it("reads the batch command's own sample file", () => {
    const result = parseCasesFile(readFileSync(new URL("../../../fixtures/cases.sample.json", import.meta.url), "utf8"));
    expect(result.ok && result.cases.labels).toEqual([
      "case-01-published-process",
      "case-02-no-hiring-page",
      "case-03-two-line-description",
      "case-04-unreachable-company",
      "case-05-same-posting-more-days",
    ]);
  });

  it("sends what the API expects: company_url in the file becomes companyUrl, and the id stays behind as the label", () => {
    const result = parseCasesFile(file([role(1)]));
    expect(result).toEqual({
      ok: true,
      cases: { items: [{ jd: "Engineer 1\n- TypeScript", companyUrl: "https://company1.example/", days: 5 }], labels: ["case-1"] },
    });
  });

  it("also accepts companyUrl, and a file that wraps the list in { cases }", () => {
    const result = parseCasesFile(file({ cases: [{ jd: "Engineer", companyUrl: "https://acme.example/", days: 3 }] }));
    expect(result.ok && result.cases.items).toEqual([{ jd: "Engineer", companyUrl: "https://acme.example/", days: 3 }]);
  });

  it("names a row by its position when it has no usable id", () => {
    const result = parseCasesFile(file([{ ...role(1), id: undefined }, { ...role(2), id: "   " }, { ...role(3), id: 7 }]));
    expect(result.ok && result.cases.labels).toEqual(["Row 1", "Row 2", "Row 3"]);
  });

  it("passes a broken row on untouched, so the API can refuse it by number instead of the whole file failing", () => {
    const result = parseCasesFile(file([role(1), "not a role", { ...role(3), jd: undefined, days: "soon" }]));
    expect(result.ok && result.cases.items).toEqual([
      { jd: "Engineer 1\n- TypeScript", companyUrl: "https://company1.example/", days: 5 },
      "not a role",
      { jd: undefined, companyUrl: "https://company3.example/", days: "soon" },
    ]);
  });

  it(`accepts exactly ${MAX_ROLES_PER_FILE} roles`, () => {
    expect(messageOf(file(Array.from({ length: MAX_ROLES_PER_FILE }, (_, i) => role(i))))).toBe("ok");
  });
});

describe("parseCasesFile — a file that cannot be used", () => {
  it.each([
    ["{ not json", "That file is not valid JSON."],
    ["", "That file is not valid JSON."],
    [file({ roles: [] }), 'Expected a list of roles: [{ "jd": "...", "company_url": "...", "days": 7 }]'],
    [file("just a string"), 'Expected a list of roles: [{ "jd": "...", "company_url": "...", "days": 7 }]'],
    [file([]), "That file contains no roles."],
    [file({ cases: [] }), "That file contains no roles."],
  ])("%j -> %s", (text, expected) => {
    expect(messageOf(text)).toBe(expected);
  });

  it("says how many roles it found when there are too many", () => {
    expect(messageOf(file(Array.from({ length: 11 }, (_, i) => role(i))))).toBe("That file has 11 roles. Upload at most 10 at a time.");
  });

  it("refuses a file too large to send, before trying to parse it", () => {
    expect(messageOf(file([{ ...role(1), jd: "x".repeat(950_000) }]))).toBe("That file is too large. Keep it under 900 KB, or split it into smaller files.");
  });

  it("measures size in bytes, not characters", () => {
    // 400,000 characters of three bytes each is 1.2 MB on the wire.
    expect(messageOf(file([{ ...role(1), jd: "€".repeat(400_000) }]))).toContain("too large");
  });
});
