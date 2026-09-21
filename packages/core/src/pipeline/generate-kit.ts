import { checkCoverage } from "../coverage/coverage";
import type { LlmProvider } from "../llm/provider";
import { crawlSite } from "../retrieval/crawl-site";
import type { CrawlOptions, CrawlResult } from "../retrieval/crawl-site";
import { validateKit } from "../schema/kit";
import type { Flashcard, Kit } from "../schema/kit";
import { buildSchedule } from "../scheduling/schedule";
import { PipelineError } from "./pipeline-error";
import { createContext, runStep } from "./run-step";
import type { ProgressEvent } from "./run-step";
import { briefWithoutResearch, researchCompany } from "./steps/company-research";
import { extractJdProfile } from "./steps/jd-profile";
import { buildQuestionBank } from "./steps/question-bank";

// The pipeline. One function, called by the web API and by the batch command alike, so
// what gets evaluated is what users get. It owns the sequence and what each step's failure
// means; the steps own their own logic.

export const DEFAULT_KIT_DEADLINE_MS = 150_000;
export const MAX_DAYS = 365;

export interface KitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface GenerateKitOptions {
  llm: LlmProvider;
  /**
   * Whether company URLs on private or loopback addresses may be fetched. The batch command
   * passes true (its sites are served from localhost); the deployed API passes false.
   */
  allowPrivateHosts: boolean;
  /** Time budget for one kit. Past it, optional model steps are skipped and the kit still ships. */
  deadlineMs?: number;
  onProgress?: (event: ProgressEvent) => void;
  /** Tests: control of time, strict bug handling, and the crawler's network. */
  now?: () => number;
  strict?: boolean;
  crawl?: Partial<CrawlOptions>;
}

const UNREACHABLE: CrawlResult = { reachable: false, companyName: "", pages: [], log: [] };

export async function generateKit(input: KitInput, options: GenerateKitOptions): Promise<Kit> {
  const ctx = createContext({
    deadlineMs: options.deadlineMs ?? DEFAULT_KIT_DEADLINE_MS,
    onProgress: options.onProgress,
    now: options.now,
    strict: options.strict,
  });
  const outOfTime = () => ctx.now() >= ctx.deadline;

  await runStep(ctx, { name: "validate_input", policy: "fatal", failureCode: "INVALID_INPUT" }, async () => {
    if (typeof input.jd !== "string" || !input.jd.trim()) {
      throw new PipelineError("INVALID_INPUT", "The job description is empty");
    }
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_DAYS) {
      throw new PipelineError("INVALID_INPUT", `days must be a whole number from 1 to ${MAX_DAYS}, got ${input.days}`);
    }
    // The company URL is deliberately not checked here: a bad URL costs the kit its company
    // research, not its existence.
  });

  // Reading the description (a model call) and crawling the site (network) do not depend on
  // each other, so they run together.
  const crawling = runStep(ctx, { name: "crawl_company_site", policy: "degrade", fallback: UNREACHABLE }, () =>
    crawlSite(input.companyUrl ?? "", {
      allowPrivateHosts: options.allowPrivateHosts,
      shouldStop: outOfTime,
      ...options.crawl,
    }),
  );

  // Nothing can be built without requirements, so this is the one fatal model step.
  let profile: Awaited<ReturnType<typeof extractJdProfile>>;
  try {
    profile = await runStep(ctx, { name: "jd_profile", policy: "fatal", failureCode: "JD_PROFILE_FAILED" }, () =>
      extractJdProfile(options.llm, input.jd, ctx),
    );
  } finally {
    // Never leave the crawl running behind a failed kit.
    await crawling.catch(() => undefined);
  }

  const crawl = await crawling;
  ctx.researchLog.push(...crawl.log);
  if (!crawl.reachable) {
    ctx.warnings.push({
      code: "COMPANY_UNREACHABLE",
      message: `The company site could not be retrieved (${crawl.log[0]?.reason ?? "no response"}); the kit is built from the job description alone`,
    });
  }

  const research = await runStep(
    ctx,
    {
      name: "company_research",
      policy: "degrade",
      failureCode: "COMPANY_RESEARCH_FAILED",
      fallback: briefWithoutResearch("the company pages were retrieved but could not be summarised"),
      skipPastDeadline: true,
    },
    () => researchCompany(options.llm, crawl, ctx),
  );

  // Draft per category, check coverage, repair the gaps, check again. Each model call inside
  // is its own step, so one category failing or running out of time costs only that category.
  const bank = await buildQuestionBank(
    options.llm,
    {
      requirements: profile.requirements,
      roleTitle: profile.title,
      seniority: profile.seniority,
      responsibilities: profile.responsibilities,
      companyResearched: research.brief.sources.length > 0,
      companyWhatTheyDo: research.brief.sources.length > 0 ? research.brief.what_they_do : "",
      hiringProcess: research.hiringProcess,
    },
    ctx,
  );
  const { questions } = bank;

  // No flashcard step exists yet, so a kit has none.
  const flashcards: Flashcard[] = [];

  // From here on it is code only, and it always runs — even past the deadline — so a late
  // kit is still a complete, valid kit. The check is repeated on the final question list so
  // that what the kit reports is computed from what the kit contains.
  const coverage = await runStep(ctx, { name: "coverage_check", policy: "fatal" }, async () =>
    checkCoverage(profile.requirements, questions),
  );
  const schedule = await runStep(ctx, { name: "schedule", policy: "fatal" }, async () =>
    buildSchedule(questions, profile.requirements, input.days),
  );

  return runStep(ctx, { name: "validate_kit", policy: "fatal", failureCode: "INVALID_KIT" }, async () => {
    const kit: Kit = {
      source: {
        // The site's own name for itself first, then what the description says. Never the hostname.
        company: crawl.companyName || profile.company,
        company_url: input.companyUrl ?? "",
        role: profile.title,
        location: profile.location,
        jd_chars: profile.jdChars,
        researched_at: new Date(ctx.now()).toISOString(),
        pages_used: crawl.pages.map((p) => p.url),
      },
      company_brief: research.brief,
      role: {
        title: profile.title,
        seniority: profile.seniority,
        responsibilities: profile.responsibilities,
        requirements: profile.requirements,
      },
      questions,
      flashcards,
      schedule,
      coverage: { uncovered_requirement_ids: coverage.uncovered, passes: bank.passes },
      warnings: ctx.warnings,
      research_log: ctx.researchLog,
      hiring_process: research.hiringProcess,
      requirement_evidence: profile.evidence,
    };

    const checked = validateKit(kit);
    if (!checked.ok) {
      const problems = checked.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new PipelineError("INVALID_KIT", `The generated kit does not match the required structure: ${problems}`);
    }
    return checked.kit;
  });
}
