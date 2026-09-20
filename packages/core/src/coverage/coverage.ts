import type { Question, Requirement } from '../schema/kit';

// One draft plus at most two repair passes. Each repair only asks for the missing
// requirements, so it converges fast; a gap that survives two targeted attempts is
// reported honestly instead of looping until the rate limit runs out.
export const MAX_COVERAGE_PASSES = 3;

export interface CoverageReport {
  /** Requirement ids with no question against them, in requirement order. */
  uncovered: string[];
  /** The subset of `uncovered` with priority "must". These block shipping. */
  uncoveredMust: string[];
  /** Requirement id -> ids of the questions that cover it. */
  coveredBy: Record<string, string[]>;
}

export function checkCoverage(requirements: Requirement[], questions: Question[]): CoverageReport {
  const coveredBy: Record<string, string[]> = {};
  for (const r of requirements) coveredBy[r.id] = [];

  for (const q of questions) {
    for (const id of new Set(q.requirement_ids)) {
      // A reference to a requirement that does not exist covers nothing.
      coveredBy[id]?.push(q.id);
    }
  }

  const gaps = requirements.filter((r) => coveredBy[r.id]!.length === 0);
  return {
    uncovered: gaps.map((r) => r.id),
    uncoveredMust: gaps.filter((r) => r.priority === 'must').map((r) => r.id),
    coveredBy,
  };
}

/**
 * Whether to run another generate-and-check pass. `passesRun` counts coverage
 * checks done so far, so it is 1 after the first draft has been checked.
 *
 * Must-haves get every pass we allow. Nice-to-haves get exactly one repair
 * attempt: worth a cheap try, not worth spending the token budget on.
 */
export function shouldRunAnotherPass(report: CoverageReport, passesRun: number): boolean {
  if (passesRun >= MAX_COVERAGE_PASSES) return false;
  if (report.uncoveredMust.length > 0) return true;
  return passesRun === 1 && report.uncovered.length > 0;
}
