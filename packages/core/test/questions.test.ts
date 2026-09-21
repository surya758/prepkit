import { describe, expect, it } from "vitest";
import { createContext, generateQuestions, planCategories, questionSchema } from "../src";
import type { CategoryPlan, HiringProcess, QuestionContext, Requirement } from "../src";
import { createFakeProvider } from "../src/testing";

const req = (id: string, kind: Requirement["kind"], priority: Requirement["priority"], text = `requirement ${id}`): Requirement => ({
  id,
  text,
  kind,
  priority,
});

const requirements = [
  req("r1", "technical", "must", "5+ years with React"),
  req("r2", "technical", "must", "Strong TypeScript"),
  req("r3", "behavioural", "must", "You have mentored junior engineers"),
  req("r4", "domain", "nice", "Logistics domain knowledge"),
];

const noProcess: HiringProcess = { found: false, stages: [], source: null };
const publishedProcess: HiringProcess = {
  found: true,
  source: "http://localhost:8099/acme/handbook/join-the-crew",
  stages: [
    { name: "Intro call", description: "30 minutes with a recruiter" },
    { name: "Take-home exercise", description: "About three hours" },
    { name: "Final round", description: "A system design interview and a values interview with the hiring manager" },
  ],
};

const byCategory = (plans: CategoryPlan[]) => Object.fromEntries(plans.map((p) => [p.category, p]));

describe("planCategories — which categories, and how many questions", () => {
  it("routes requirements by kind: technical and domain together, behavioural apart", () => {
    const { plans } = planCategories({ requirements, seniority: "mid", hiringProcess: noProcess, companyResearched: true });
    const plan = byCategory(plans);

    expect(plan.technical!.requirements.map((r) => r.id)).toEqual(["r1", "r2", "r4"]);
    expect(plan.behavioural!.requirements.map((r) => r.id)).toEqual(["r3"]);
    expect(plan["company-fit"]!.requirements).toEqual([]);
  });

  it("asks two questions per must-have and one per nice-to-have, within bounds", () => {
    const { plans } = planCategories({ requirements, seniority: "mid", hiringProcess: noProcess, companyResearched: true });
    expect(byCategory(plans).technical!.count).toBe(5); // 2 musts x 2 + 1 nice
    expect(byCategory(plans).behavioural!.count).toBe(2); // 1 must x 2

    const many = Array.from({ length: 9 }, (_, i) => req(`r${i + 1}`, "technical", "must"));
    const capped = planCategories({ requirements: many, seniority: "", hiringProcess: noProcess, companyResearched: false });
    expect(byCategory(capped.plans).technical!.count).toBe(10);
  });

  it("produces a different plan for a company that publishes a take-home and a design round", () => {
    const quiet = byCategory(planCategories({ requirements, seniority: "mid", hiringProcess: noProcess, companyResearched: true }).plans);
    const loud = byCategory(planCategories({ requirements, seniority: "mid", hiringProcess: publishedProcess, companyResearched: true }).plans);

    // Nothing published and not a senior role: no design questions at all.
    expect(quiet["system-design"]).toBeUndefined();
    // A published design round: four of them, flagged as a priority.
    expect(loud["system-design"]).toMatchObject({ count: 4, reason: "The company publishes a system design round" });

    expect(quiet["company-fit"]!.count).toBe(2);
    expect(loud["company-fit"]!.count).toBe(3);
    expect(loud["company-fit"]!.notes[0]).toContain("take-home exercise");
    expect(loud.technical!.notes[0]).toContain("practical");
    expect(loud.behavioural!.notes[0]).toContain("Final round");
  });

  it("adds design questions for a senior role even when no process is published", () => {
    const { plans } = planCategories({ requirements, seniority: "senior", hiringProcess: noProcess, companyResearched: false });
    expect(byCategory(plans)["system-design"]).toMatchObject({ count: 2, reason: "The role is senior-level" });
    // Design problems are built around the stack, not around domain knowledge.
    expect(byCategory(plans)["system-design"]!.requirements.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("skips company-fit when nothing is known about the company, and says why", () => {
    const { plans, skipped } = planCategories({ requirements, seniority: "mid", hiringProcess: noProcess, companyResearched: false });
    expect(plans.map((p) => p.category)).toEqual(["technical", "behavioural"]);
    expect(skipped).toContainEqual({
      category: "company-fit",
      reason: "Nothing is known about the company, so company questions would be guesses",
    });
  });

  it("plans nothing requirement-based for a description with no requirements", () => {
    const { plans, skipped } = planCategories({ requirements: [], seniority: "", hiringProcess: noProcess, companyResearched: false });
    expect(plans).toEqual([]);
    expect(skipped.map((s) => s.category)).toEqual(["technical", "behavioural", "system-design", "company-fit"]);
  });

  it("still prepares for a published values interview when the description lists no behavioural requirement", () => {
    const technicalOnly = requirements.filter((r) => r.kind !== "behavioural");
    const { plans } = planCategories({ requirements: technicalOnly, seniority: "mid", hiringProcess: publishedProcess, companyResearched: true });
    expect(byCategory(plans).behavioural).toMatchObject({ requirements: [], count: 2 });
  });
});

const context: QuestionContext = {
  roleTitle: "Senior Frontend Engineer",
  seniority: "senior",
  responsibilities: ["Own the dispatcher dashboard"],
  companyWhatTheyDo: "Route planning software for mid-size retailers.",
  hiringProcess: publishedProcess,
};
const ctx = () => createContext({ deadlineMs: 150_000, strict: true });
const plansFor = () => byCategory(planCategories({ requirements, seniority: "senior", hiringProcess: publishedProcess, companyResearched: true }).plans);
const q = (prompt: string, requirement_ids: string[], difficulty: unknown = 2) => ({ prompt, answer_outline: "Point one. Point two.", difficulty, requirement_ids });

describe("generateQuestions — one call per category, each with its own instructions", () => {
  it("gives each category a different system prompt", async () => {
    const systems = new Set<string>();
    for (const plan of Object.values(plansFor())) {
      const model = createFakeProvider([{ questions: [q("A sufficiently long question?", plan.requirements[0] ? [plan.requirements[0].id] : [])] }]);
      await generateQuestions(model, plan, context, ctx());
      systems.add(model.calls[0]!.system);
    }
    expect(systems.size).toBe(4);
  });

  it("sends only that category's requirements, as delimited data", async () => {
    const model = createFakeProvider([{ questions: [q("Tell me about a time you mentored someone.", ["r3"])] }]);
    await generateQuestions(model, plansFor().behavioural!, context, ctx());

    const { system, user } = model.calls[0]!;
    expect(system).toContain("BEHAVIOURAL");
    expect(system).toContain("Do not ask about technologies");
    expect(user).toContain("<requirements>\nr3 [must] You have mentored junior engineers\n</requirements>");
    expect(user).not.toContain("React");
    expect(user).toContain("Write 2 question(s).");
  });

  it("stamps the category in code and returns drafts the kit schema accepts once given an id", async () => {
    const model = createFakeProvider([{ questions: [q("How do you decide where state lives in a React app?", ["r1", "r2"], 2)] }]);
    const drafts = await generateQuestions(model, plansFor().technical!, context, ctx());

    expect(drafts).toEqual([
      {
        requirement_ids: ["r1", "r2"],
        category: "technical",
        prompt: "How do you decide where state lives in a React app?",
        answer_outline: "Point one. Point two.",
        difficulty: 2,
      },
    ]);
    expect(questionSchema.safeParse({ id: "q1", ...drafts[0] }).success).toBe(true);
  });

  it("ignores requirement ids the model invented or borrowed from another category", async () => {
    const model = createFakeProvider([{ questions: [q("How would you type a generic component?", ["r2", "r3", "r99"])] }]);
    const drafts = await generateQuestions(model, plansFor().technical!, context, ctx());
    expect(drafts[0]!.requirement_ids).toEqual(["r2"]); // r3 is behavioural, r99 does not exist
  });

  it("drops a technical question that ends up tied to no requirement, and duplicates", async () => {
    const context_ = ctx();
    const model = createFakeProvider([
      {
        questions: [
          q("Explain how React reconciliation works.", ["r1"]),
          q("Explain how React reconciliation works!", ["r1"]),
          q("What is your favourite editor and why?", ["r99"]),
        ],
      },
    ]);
    const drafts = await generateQuestions(model, plansFor().technical!, context, context_);

    expect(drafts.map((d) => d.prompt)).toEqual(["Explain how React reconciliation works."]);
    expect(context_.researchLog[0]).toMatchObject({ step: "questions:technical", outcome: "ok" });
    expect(context_.researchLog[0]!.reason).toContain("1 question(s) kept, 2 dropped");
  });

  it("keeps company-fit questions even though they map to no requirement", async () => {
    const model = createFakeProvider([{ questions: [q("Why route planning, and why Acme in particular?", [])] }]);
    const drafts = await generateQuestions(model, plansFor()["company-fit"]!, context, ctx());
    expect(drafts).toHaveLength(1);
    expect(model.calls[0]!.user).toContain("<company>\nRoute planning software for mid-size retailers.\n</company>");
    expect(model.calls[0]!.user).toContain("One question must be about how to approach and present this company's take-home exercise.");
  });

  it.each([
    ["easy", 1],
    ["Hard", 3],
    [2.6, 3],
    [0, 1],
    [7, 3],
    ["not sure", 2],
  ])("coerces difficulty %j to %i instead of spending a re-ask", async (given, expected) => {
    const model = createFakeProvider([{ questions: [q("How do hooks differ from classes?", ["r1"], given)] }]);
    const drafts = await generateQuestions(model, plansFor().technical!, context, ctx());
    expect(drafts[0]!.difficulty).toBe(expected);
    expect(model.calls).toHaveLength(1);
  });

  it("accepts an answer outline written as a list of points", async () => {
    const reply = { questions: [{ ...q("How do hooks differ from classes?", ["r1"]), answer_outline: ["Closures.", "Lifecycle mapping."] }] };
    const drafts = await generateQuestions(createFakeProvider([reply]), plansFor().technical!, context, ctx());
    expect(drafts[0]!.answer_outline).toBe("Closures. Lifecycle mapping.");
  });

  it("tells the model which questions already exist, for a gap-filling pass", async () => {
    const model = createFakeProvider([{ questions: [q("How do you profile a slow render?", ["r1"])] }]);
    await generateQuestions(model, plansFor().technical!, { ...context, existingPrompts: ["Explain reconciliation."] }, ctx());
    expect(model.calls[0]!.user).toContain("<existing_questions>\n- Explain reconciliation.\n</existing_questions>");
  });

  it("logs an empty result rather than failing when every question was unusable", async () => {
    const context_ = ctx();
    const drafts = await generateQuestions(createFakeProvider([{ questions: [q("What is your favourite colour?", [])] }]), plansFor().technical!, context, context_);
    expect(drafts).toEqual([]);
    expect(context_.researchLog[0]!.outcome).toBe("empty");
  });
});
