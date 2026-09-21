import type { LlmProvider } from "../llm/provider";
import { PipelineError } from "../pipeline/pipeline-error";
import { createContext } from "../pipeline/run-step";
import { researchCompany } from "../pipeline/steps/company-research";
import { generateQuestions, planCategories } from "../pipeline/steps/questions";
import type { CategoryPlan, DraftQuestion } from "../pipeline/steps/questions";
import { crawlSite } from "../retrieval/crawl-site";
import type { CrawlOptions } from "../retrieval/crawl-site";
import type { HiringProcess, Kit, Question, Warning } from "../schema/kit";

// The model's half of regenerating one section. These produce fresh material from what the
// kit already holds; they decide nothing about what is kept. That is kit-editor's job, and it
// is done afterwards, against the kit as it is by then.

const REGENERATION_DEADLINE_MS = 60_000;
const NO_PROCESS: HiringProcess = { found: false, stages: [], source: null };

export interface FreshQuestions {
  drafts: DraftQuestion[];
  warnings: Warning[];
}

/**
 * Fresh questions for one category, written by the same prompt and the same plan that wrote
 * the originals. `lockedCount` is how many questions in that category will be kept, so the
 * category ends up about the size it was planned to be rather than growing on every press.
 */
export async function regenerateCategoryDrafts(llm: LlmProvider, kit: Kit, category: Question["category"], lockedCount: number): Promise<FreshQuestions> {
  const hiringProcess = kit.hiring_process ?? NO_PROCESS;
  const companyResearched = kit.company_brief.sources.length > 0;
  const { plans, skipped } = planCategories({
    requirements: kit.role.requirements,
    seniority: kit.role.seniority,
    hiringProcess,
    companyResearched,
  });

  let plan: CategoryPlan | undefined = plans.find((p) => p.category === category);
  if (!plan) {
    // The pipeline skipped this category, but the user may have added questions to it by hand
    // and now want more. That is allowed wherever there is something to write them from.
    const technical = kit.role.requirements.filter((r) => r.kind === "technical");
    if (category === "behavioural") plan = { category, requirements: [], count: 2, notes: [], reason: "Requested by the user" };
    if (category === "system-design" && technical.length > 0) plan = { category, requirements: technical, count: 2, notes: [], reason: "Requested by the user" };
  }
  if (!plan) {
    const why = skipped.find((s) => s.category === category)?.reason ?? "There is nothing to write these questions from";
    throw new PipelineError("NOTHING_TO_GENERATE_FROM", why);
  }

  const ctx = createContext({ deadlineMs: REGENERATION_DEADLINE_MS });
  const drafts = await generateQuestions(
    llm,
    { ...plan, count: Math.max(1, plan.count - lockedCount) },
    {
      roleTitle: kit.role.title,
      seniority: kit.role.seniority,
      responsibilities: kit.role.responsibilities,
      companyWhatTheyDo: companyResearched ? kit.company_brief.what_they_do : "",
      hiringProcess,
      publicDiscussion: kit.public_discussion?.hits.map((hit) => `(${hit.posted_at.slice(0, 4)}) ${hit.excerpt}`),
      // Every question in the kit, kept or not: a regenerated category should bring new questions.
      existingPrompts: kit.questions.map((q) => q.prompt),
    },
    ctx,
  );
  return { drafts, warnings: ctx.warnings };
}

export interface FreshBrief {
  brief: Kit["company_brief"];
  warnings: Warning[];
}

/**
 * A fresh brief means reading the company site again: the pages are not stored with the kit.
 * If the site cannot be reached now, that is an error and the existing brief stays — an empty
 * "nothing was researched" brief must never replace one that was researched.
 */
export async function regenerateBriefFresh(llm: LlmProvider, kit: Kit, options: { allowPrivateHosts: boolean; crawl?: Partial<CrawlOptions> }): Promise<FreshBrief> {
  const crawl = await crawlSite(kit.source.company_url, { allowPrivateHosts: options.allowPrivateHosts, ...options.crawl });
  if (!crawl.reachable || crawl.pages.length === 0) {
    throw new PipelineError("COMPANY_UNREACHABLE", `The company site could not be read, so the brief was left as it is (${crawl.log[0]?.reason ?? "no pages"})`);
  }
  const ctx = createContext({ deadlineMs: REGENERATION_DEADLINE_MS });
  const research = await researchCompany(llm, crawl, ctx);
  return { brief: research.brief, warnings: ctx.warnings };
}
