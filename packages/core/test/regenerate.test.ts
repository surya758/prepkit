import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { regenerateBriefFresh, regenerateCategoryDrafts } from "../src";
import type { Kit } from "../src";
import { createFakeProvider } from "../src/testing";
import { startCompanySites } from "./fixtures/company-sites";
import type { FixtureServer } from "./fixtures/company-sites";
import { makeKit } from "./fixtures/kit";
import { categoryOf, requirementIdsIn } from "./fixtures/scripted-model";

let sites: FixtureServer;
beforeAll(async () => {
  sites = await startCompanySites();
});
afterAll(() => sites.close());

const question = (prompt: string, requirement_ids: string[]) => ({ prompt, answer_outline: "Outline.", difficulty: 2, requirement_ids });

/** makeKit() has r1 technical (must), r2 behavioural (must), r3 domain (nice), and a researched brief. */
const kit = (): Kit => makeKit();

describe("regenerateCategoryDrafts", () => {
  it("asks the category's own prompt for that category's requirements, from what the kit already holds", async () => {
    const model = createFakeProvider([{ questions: [question("Tell me about a time you unblocked a junior engineer.", ["r2"])] }]);
    const { drafts } = await regenerateCategoryDrafts(model, kit(), "behavioural", 0);

    expect(categoryOf(model.calls[0]!)).toBe("behavioural");
    expect(requirementIdsIn(model.calls[0]!)).toEqual(["r2"]);
    expect(drafts).toEqual([
      { category: "behavioural", prompt: "Tell me about a time you unblocked a junior engineer.", answer_outline: "Outline.", difficulty: 2, requirement_ids: ["r2"] },
    ]);
  });

  it("tells the model every question already in the kit, so a regenerated category brings new ones", async () => {
    const model = createFakeProvider([{ questions: [question("How do you profile a slow render?", ["r1"])] }]);
    await regenerateCategoryDrafts(model, kit(), "technical", 0);
    expect(model.calls[0]!.user).toContain("<existing_questions>");
    expect(model.calls[0]!.user).toContain("How do you decide where state lives in a large React app?");
  });

  it("asks for fewer questions when some are being kept, and never for none", async () => {
    const count = async (locked: number) => {
      const model = createFakeProvider([{ questions: [question("A sufficiently long question?", ["r1"])] }]);
      await regenerateCategoryDrafts(model, kit(), "technical", locked);
      return Number(/Write (\d+) question/.exec(model.calls[0]!.user)![1]);
    };
    const planned = await count(0);
    expect(await count(1)).toBe(planned - 1);
    expect(await count(99)).toBe(1);
  });

  it("refuses, with the reason, when there is nothing to write the category from", async () => {
    const unresearched = kit();
    unresearched.company_brief.sources = [];
    await expect(regenerateCategoryDrafts(createFakeProvider([]), unresearched, "company-fit", 0)).rejects.toMatchObject({
      code: "NOTHING_TO_GENERATE_FROM",
      message: "Nothing is known about the company, so company questions would be guesses",
    });
  });

  it("lets the user ask for a category the pipeline skipped, where there is something to write it from", async () => {
    const junior = kit();
    junior.role.seniority = "junior"; // the pipeline plans no system-design questions for this role
    const model = createFakeProvider([{ questions: [question("Design a rate limiter for our API.", ["r1"])] }]);
    const { drafts } = await regenerateCategoryDrafts(model, junior, "system-design", 0);
    expect(drafts[0]!.category).toBe("system-design");
  });
});

describe("regenerateBriefFresh", () => {
  const research = { summary: "Acme plans deliveries.", what_they_do: "Route planning software.", hiring_stages: [] };

  it("reads the company site again and writes a fresh brief from it", async () => {
    const stored = kit();
    stored.source.company_url = `${sites.origin}/acme/`;
    const { brief } = await regenerateBriefFresh(createFakeProvider([research]), stored, { allowPrivateHosts: true, crawl: { sleep: async () => {} } });

    expect(brief.summary).toBe("Acme plans deliveries.");
    expect(brief.sources).toContain(`${sites.origin}/acme/`);
  });

  it("refuses, rather than returning an empty brief, when the site cannot be read now", async () => {
    const stored = kit();
    stored.source.company_url = "http://127.0.0.1:1/gone/";
    const model = createFakeProvider([]);
    await expect(regenerateBriefFresh(model, stored, { allowPrivateHosts: true, crawl: { maxAttempts: 1, sleep: async () => {} } })).rejects.toMatchObject({
      code: "COMPANY_UNREACHABLE",
    });
    expect(model.calls).toHaveLength(0);
  });
});
