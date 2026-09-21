import { checkCoverage, shouldRunAnotherPass } from "../../coverage/coverage";
import type { CoverageReport } from "../../coverage/coverage";
import type { LlmProvider } from "../../llm/provider";
import type { HiringProcess, Question, Requirement } from "../../schema/kit";
import { normalise } from "../grounding";
import { runStep } from "../run-step";
import type { PipelineContext } from "../run-step";
import { generateQuestions, planCategories } from "./questions";
import type { CategoryPlan, DraftQuestion, QuestionContext } from "./questions";

// The second pass. "A kit that ships with uncovered must-have requirements has failed at the
// one job it had" — so after the first draft, code works out which requirements no question
// covers, asks only for those, and checks again. Finding the gaps is set arithmetic; only
// writing the missing questions goes to the model.

export interface QuestionBankInput {
  requirements: Requirement[];
  roleTitle: string;
  seniority: string;
  responsibilities: string[];
  companyWhatTheyDo: string;
  companyResearched: boolean;
  hiringProcess: HiringProcess;
}

export interface QuestionBank {
  questions: Question[];
  coverage: CoverageReport;
  /** How many coverage checks ran. 1 means the first draft needed no repair. */
  passes: number;
}

const DUPLICATE_SIMILARITY = 0.8;

const words = (prompt: string) => new Set(normalise(prompt).split(" ").filter((w) => w.length > 2));

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export async function buildQuestionBank(llm: LlmProvider, input: QuestionBankInput, ctx: PipelineContext): Promise<QuestionBank> {
  const questions: Question[] = [];
  const fingerprints: Set<string>[] = [];

  // Two categories can arrive at the same question. The first one stays, and takes on the
  // requirements the duplicate claimed, so merging never loses coverage.
  const add = (drafts: DraftQuestion[]) => {
    for (const draft of drafts) {
      const fingerprint = words(draft.prompt);
      const twin = fingerprints.findIndex((existing) => similarity(existing, fingerprint) >= DUPLICATE_SIMILARITY);
      if (twin !== -1) {
        const kept = questions[twin]!;
        kept.requirement_ids = [...new Set([...kept.requirement_ids, ...draft.requirement_ids])];
        continue;
      }
      // Ids come from a counter, never from the model, so they are unique and stable.
      questions.push({ id: `q${questions.length + 1}`, ...draft });
      fingerprints.push(fingerprint);
    }
  };

  const context = (): QuestionContext => ({
    roleTitle: input.roleTitle,
    seniority: input.seniority,
    responsibilities: input.responsibilities,
    companyWhatTheyDo: input.companyWhatTheyDo,
    hiringProcess: input.hiringProcess,
    existingPrompts: questions.map((q) => q.prompt),
  });

  // One category failing must not cost the others: it degrades to no questions, which the
  // coverage check then reports as gaps — so the repair pass doubles as the recovery path.
  const generate = (plan: CategoryPlan, stepName: string) =>
    runStep(ctx, { name: stepName, policy: "degrade", fallback: [] as DraftQuestion[], skipPastDeadline: true }, () =>
      generateQuestions(llm, plan, context(), ctx),
    );

  const { plans, skipped } = planCategories(input);
  for (const skip of skipped) {
    ctx.researchLog.push({ step: `questions:${skip.category}`, url: null, outcome: "skipped", reason: skip.reason });
  }

  // First draft. The calls are issued together; the shared rate limiter is what paces them.
  const firstDraft = await Promise.all(plans.map((plan) => generate(plan, `questions:${plan.category}`)));
  firstDraft.forEach(add);

  let passes = 1;
  let coverage = checkCoverage(input.requirements, questions);

  while (shouldRunAnotherPass(coverage, passes)) {
    // Nice-to-haves get the first repair pass only; after that only must-haves are chased.
    const chase = new Set(passes === 1 ? coverage.uncovered : coverage.uncoveredMust);
    const missing = input.requirements.filter((r) => chase.has(r.id));
    const gapPlans: CategoryPlan[] = [
      { category: "technical" as const, requirements: missing.filter((r) => r.kind !== "behavioural") },
      { category: "behavioural" as const, requirements: missing.filter((r) => r.kind === "behavioural") },
    ]
      .filter((group) => group.requirements.length > 0)
      .map((group) => ({
        ...group,
        count: group.requirements.length,
        notes: ["These requirements have no question yet. Write exactly one question for each of them."],
        reason: `Coverage repair pass ${passes}: ${group.requirements.map((r) => r.id).join(", ")} had no question`,
      }));

    const repairs = await Promise.all(gapPlans.map((plan) => generate(plan, `questions:repair_${passes}:${plan.category}`)));
    repairs.forEach(add);

    passes += 1;
    coverage = checkCoverage(input.requirements, questions);
  }

  if (coverage.uncoveredMust.length > 0) {
    ctx.warnings.push({
      code: "UNCOVERED_MUST_HAVES",
      message: `No question could be generated for must-have requirement(s) ${coverage.uncoveredMust.join(", ")} after ${passes} coverage passes`,
    });
  }
  ctx.researchLog.push({
    step: "coverage",
    url: null,
    outcome: "ok",
    reason: `${questions.length} question(s) after ${passes} coverage pass(es); uncovered: ${coverage.uncovered.join(", ") || "none"}`,
  });

  return { questions, coverage, passes };
}
