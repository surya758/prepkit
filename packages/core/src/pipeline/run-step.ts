import type { ResearchLogEntry, Warning } from "../schema/kit";
import { PipelineError } from "./pipeline-error";

// Every pipeline step needs the same five things around it: a progress event, a timer,
// the deadline check, a rule for what failure means, and a record of what happened.
// runStep is that rule written once, so each step is only its own logic.

export interface ProgressEvent {
  step: string;
  status: "started" | "completed" | "skipped" | "failed";
  at: string;
  durationMs?: number;
  message?: string;
}

export interface PipelineContext {
  /** Epoch ms after which optional steps are skipped so the case still finishes. */
  deadline: number;
  now: () => number;
  emit: (event: ProgressEvent) => void;
  warnings: Warning[];
  researchLog: ResearchLogEntry[];
  /** Tests and development: rethrow bugs instead of degrading past them. */
  strict: boolean;
}

export interface CreateContextOptions {
  deadlineMs: number;
  onProgress?: (event: ProgressEvent) => void;
  now?: () => number;
  strict?: boolean;
}

export function createContext(options: CreateContextOptions): PipelineContext {
  const now = options.now ?? Date.now;
  return {
    deadline: now() + options.deadlineMs,
    now,
    emit: options.onProgress ?? (() => {}),
    warnings: [],
    researchLog: [],
    strict: options.strict ?? false,
  };
}

/**
 * What a failure of this step means for the kit.
 * - fatal: nothing useful can be built without it (the JD profile). The case fails.
 * - degrade: the kit is thinner without it (company brief, one question category).
 *   Record why, return the fallback, carry on.
 */
export type StepSpec<T> = { name: string; failureCode?: string } & (
  | { policy: "fatal" }
  | {
      policy: "degrade";
      fallback: T;
      /** Model calls set this; the code-only tail (coverage, schedule) never does. */
      skipPastDeadline?: boolean;
    }
);

// fetchPage and the LLM layer turn their own expected errors into values or
// PipelineErrors, so one of these reaching us means a bug in a step.
const isBug = (error: unknown) =>
  error instanceof TypeError ||
  error instanceof ReferenceError ||
  error instanceof RangeError;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function runStep<T>(
  ctx: PipelineContext,
  spec: StepSpec<T>,
  fn: () => Promise<T>,
): Promise<T> {
  const at = () => new Date(ctx.now()).toISOString();

  if (
    spec.policy === "degrade" &&
    spec.skipPastDeadline &&
    ctx.now() >= ctx.deadline
  ) {
    const message = "Skipped: the time budget for this kit was used up";
    ctx.emit({ step: spec.name, status: "skipped", at: at(), message });
    ctx.warnings.push({ code: "DEADLINE_REACHED", message: `${spec.name}: ${message}` });
    ctx.researchLog.push({ step: spec.name, url: null, outcome: "skipped", reason: message });
    return spec.fallback;
  }

  const startedAt = ctx.now();
  ctx.emit({ step: spec.name, status: "started", at: at() });

  try {
    const result = await fn();
    ctx.emit({
      step: spec.name,
      status: "completed",
      at: at(),
      durationMs: ctx.now() - startedAt,
    });
    return result;
  } catch (error) {
    const bug = isBug(error);
    const code = bug
      ? "INTERNAL_ERROR"
      : error instanceof PipelineError
        ? error.code
        : (spec.failureCode ?? "STEP_FAILED");
    const message = messageOf(error);

    ctx.emit({
      step: spec.name,
      status: "failed",
      at: at(),
      durationMs: ctx.now() - startedAt,
      message,
    });

    if (bug && ctx.strict) throw error;
    if (spec.policy === "fatal") {
      throw error instanceof PipelineError
        ? error
        : new PipelineError(code, `${spec.name}: ${message}`, { cause: error });
    }

    // Degrade. A bug still gets its own code, so it is visible in the kit and the
    // logs rather than passing for an ordinary failed source.
    if (bug) console.error(`[pipeline] bug in step "${spec.name}"`, error);
    ctx.warnings.push({ code, message: `${spec.name}: ${message}` });
    ctx.researchLog.push({ step: spec.name, url: null, outcome: "failed", reason: message });
    return spec.fallback;
  }
}
