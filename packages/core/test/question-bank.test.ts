import { describe, expect, it } from "vitest";
import { MAX_COVERAGE_PASSES, PipelineError, buildQuestionBank, createContext, questionSchema } from "../src";
import type { LlmRequest, QuestionBankInput, Requirement } from "../src";
import { categoryOf, goodQuestions, isRepairCall, requirementIdsIn, scriptedModel } from "./fixtures/scripted-model";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
  { id: "r2", text: "Strong TypeScript", kind: "technical", priority: "must" },
  { id: "r3", text: "You have mentored junior engineers", kind: "behavioural", priority: "must" },
  { id: "r4", text: "Logistics domain knowledge", kind: "domain", priority: "nice" },
];

const input: QuestionBankInput = {
  requirements,
  roleTitle: "Frontend Engineer",
  seniority: "mid",
  responsibilities: ["Own the dispatcher dashboard"],
  companyWhatTheyDo: "",
  companyResearched: false,
  hiringProcess: { found: false, stages: [], source: null },
};

const ctx = () => createContext({ deadlineMs: 150_000, strict: true });

/** A model that behaves, except that it never writes a question for the given requirement ids. */
const forgetting = (forgotten: string[], alsoOnRepair = false) => (request: LlmRequest) => {
  const reply = goodQuestions(request) as { questions: { requirement_ids: string[] }[] };
  if (isRepairCall(request) && !alsoOnRepair) return reply;
  return { questions: reply.questions.filter((q) => !q.requirement_ids.some((id) => forgotten.includes(id))) };
};

describe("buildQuestionBank — the first draft", () => {
  it("needs one pass when every requirement gets a question", async () => {
    const model = scriptedModel({});
    const bank = await buildQuestionBank(model, input, ctx());

    expect(bank.passes).toBe(1);
    expect(bank.coverage.uncovered).toEqual([]);
    expect(model.calls.map(categoryOf)).toEqual(["technical", "behavioural"]); // no repair call was made
  });

  it("numbers questions q1..qn from a counter, and each one satisfies the kit schema", async () => {
    const bank = await buildQuestionBank(scriptedModel({}), input, ctx());
    expect(bank.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(bank.questions.map((q) => q.category)).toEqual(["technical", "technical", "technical", "behavioural"]);
    for (const question of bank.questions) expect(questionSchema.safeParse(question).success).toBe(true);
  });

  it("makes no model call at all for a description with no requirements and an unknown company", async () => {
    const model = scriptedModel({});
    const bank = await buildQuestionBank(model, { ...input, requirements: [] }, ctx());
    expect(bank).toMatchObject({ questions: [], passes: 1 });
    expect(model.calls).toHaveLength(0);
  });

  it("records why a category was skipped", async () => {
    const context = ctx();
    await buildQuestionBank(scriptedModel({}), input, context);
    expect(context.researchLog).toContainEqual({
      step: "questions:company-fit",
      url: null,
      outcome: "skipped",
      reason: "Nothing is known about the company, so company questions would be guesses",
    });
  });
});

describe("buildQuestionBank — the second pass", () => {
  it("finds the uncovered must-have in code, asks only for it, and closes the gap", async () => {
    const model = scriptedModel({ questions: forgetting(["r3"]) });
    const context = ctx();
    const bank = await buildQuestionBank(model, input, context);

    expect(bank.passes).toBe(2);
    expect(bank.coverage.uncovered).toEqual([]);
    expect(bank.coverage.coveredBy.r3).toHaveLength(1);

    const repair = model.calls.find(isRepairCall)!;
    expect(categoryOf(repair)).toBe("behavioural"); // r3 is behavioural, so the behavioural prompt repairs it
    expect(requirementIdsIn(repair)).toEqual(["r3"]); // only the gap, not the whole list again
    expect(repair.user).toContain("Write 1 question(s).");
    expect(context.warnings).toEqual([]);
  });

  it("tells the repair call which questions already exist", async () => {
    const model = scriptedModel({ questions: forgetting(["r2"]) });
    await buildQuestionBank(model, input, ctx());
    const repair = model.calls.find(isRepairCall)!;
    expect(repair.user).toContain("<existing_questions>");
    expect(repair.user).toContain("technical question number technical-r1-0 about r1?");
  });

  it("repairs technical and behavioural gaps with their own prompts, in the same pass", async () => {
    const model = scriptedModel({ questions: forgetting(["r2", "r3"]) });
    const bank = await buildQuestionBank(model, input, ctx());

    const repairs = model.calls.filter(isRepairCall);
    expect(repairs.map(categoryOf).sort()).toEqual(["behavioural", "technical"]);
    expect(bank).toMatchObject({ passes: 2 });
    expect(bank.coverage.uncovered).toEqual([]);
  });

  it("gives a nice-to-have exactly one repair attempt, then ships with the gap reported", async () => {
    const model = scriptedModel({ questions: forgetting(["r4"], true) });
    const context = ctx();
    const bank = await buildQuestionBank(model, input, context);

    expect(bank.passes).toBe(2);
    expect(bank.coverage.uncovered).toEqual(["r4"]);
    expect(model.calls.filter(isRepairCall)).toHaveLength(1);
    expect(context.warnings).toEqual([]); // a missing nice-to-have is reported, not alarmed about
  });

  it("stops at the pass limit for a must-have that cannot be covered, and says so", async () => {
    const model = scriptedModel({ questions: forgetting(["r3"], true) });
    const context = ctx();
    const bank = await buildQuestionBank(model, input, context);

    expect(bank.passes).toBe(MAX_COVERAGE_PASSES);
    expect(bank.coverage.uncoveredMust).toEqual(["r3"]);
    expect(model.calls.filter(isRepairCall)).toHaveLength(MAX_COVERAGE_PASSES - 1);
    expect(context.warnings).toEqual([
      { code: "UNCOVERED_MUST_HAVES", message: "No question could be generated for must-have requirement(s) r3 after 3 coverage passes" },
    ]);
  });

  it("chases only must-haves after the first repair pass", async () => {
    const model = scriptedModel({ questions: forgetting(["r3", "r4"], true) });
    await buildQuestionBank(model, input, ctx());

    const repairs = model.calls.filter(isRepairCall);
    const secondRound = repairs.slice(2); // round one: technical(r4) + behavioural(r3); round two: behavioural(r3) only
    expect(secondRound.map(requirementIdsIn)).toEqual([["r3"]]);
  });

  it("recovers a category whose first call failed outright: the repair pass is the retry", async () => {
    let technicalCalls = 0;
    const model = scriptedModel({
      questions: (request) => {
        if (categoryOf(request) === "technical" && technicalCalls++ === 0) return new PipelineError("LLM_RATE_LIMITED", "429");
        return goodQuestions(request);
      },
    });
    const context = createContext({ deadlineMs: 150_000 });
    const bank = await buildQuestionBank(model, input, context);

    expect(bank.passes).toBe(2);
    expect(bank.coverage.uncovered).toEqual([]);
    expect(context.warnings).toContainEqual({ code: "LLM_RATE_LIMITED", message: "questions:technical: 429" });
  });
});

describe("buildQuestionBank — duplicates across categories", () => {
  it("keeps one copy and gives it the requirements both copies claimed", async () => {
    const senior = { ...input, seniority: "senior" }; // adds a system-design call over r1 and r2
    const model = scriptedModel({
      questions: (request) => {
        const shared = { answer_outline: "Outline.", difficulty: 3 };
        if (categoryOf(request) === "technical") {
          return { questions: [{ ...shared, prompt: "How would you design state management for a large React dashboard?", requirement_ids: ["r1"] }, ...(goodQuestions(request) as { questions: object[] }).questions] };
        }
        if (categoryOf(request) === "system-design") {
          return { questions: [{ ...shared, prompt: "How would you design the state management for a large React dashboard", requirement_ids: ["r2"] }] };
        }
        return goodQuestions(request);
      },
    });
    const bank = await buildQuestionBank(model, senior, ctx());

    const copies = bank.questions.filter((q) => q.prompt.includes("state management"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ category: "technical", requirement_ids: ["r1", "r2"] });
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
  });
});
