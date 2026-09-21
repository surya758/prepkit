import { generateKit } from "../pipeline/generate-kit";
import type { GenerateKitOptions } from "../pipeline/generate-kit";
import { PipelineError } from "../pipeline/pipeline-error";
import { batchCaseSchema } from "../schema/batch";
import type { BatchEntry, BatchOutput } from "../schema/batch";
import type { Kit } from "../schema/kit";
import { buildSchedule } from "../scheduling/schedule";

// The batch entry point's engine (brief, section 9). It calls generateKit — the same function
// the web API calls — once per case, so what is evaluated is what users get.

export const BATCH_VERSION = "1.0";
export const DEFAULT_BATCH_CONCURRENCY = 3;

export interface RunBatchOptions extends Omit<GenerateKitOptions, "onProgress"> {
  /** Cases in flight at once. The shared rate limiter, not this number, keeps calls inside the provider's limits. */
  concurrency?: number;
  /** Called as each case finishes, with everything finished so far, so partial output can be saved. */
  onCaseDone?: (entry: BatchEntry, progress: { done: number; total: number; output: BatchOutput }) => void | Promise<void>;
}

const idOf = (raw: unknown, index: number): string => {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.trim() ? id : `case-${index + 1}`;
};

export async function runBatch(rawCases: unknown, options: RunBatchOptions): Promise<BatchOutput> {
  if (!Array.isArray(rawCases)) {
    throw new PipelineError("INVALID_INPUT", "The input file must contain a JSON array of cases");
  }

  const { concurrency = DEFAULT_BATCH_CONCURRENCY, onCaseDone, ...kitOptions } = options;
  const now = options.now ?? Date.now;
  const generatedAt = new Date(now()).toISOString();
  const entries: (BatchEntry | undefined)[] = new Array(rawCases.length).fill(undefined);
  const snapshot = (): BatchOutput => ({
    version: BATCH_VERSION,
    generated_at: generatedAt,
    kits: entries.filter((e): e is BatchEntry => e !== undefined),
  });

  // The same description and company submitted twice is researched once. The promise is
  // what is cached, so a duplicate that starts while the first is still running waits for it
  // rather than racing it.
  const inFlight = new Map<string, Promise<Kit>>();

  async function runCase(raw: unknown, index: number): Promise<BatchEntry> {
    const id = idOf(raw, index);
    // Cases are parsed one at a time so that one malformed case is recorded, not fatal.
    const parsed = batchCaseSchema.safeParse(raw);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "case"}: ${i.message}`).join("; ");
      return { id, status: "failed", kit: null, error: { code: "INVALID_INPUT", message: `Malformed case: ${problems}` } };
    }

    const { jd, company_url, days } = parsed.data;
    try {
      const fingerprint = JSON.stringify([jd.trim(), company_url.trim()]);
      let shared = inFlight.get(fingerprint);
      const reused = shared !== undefined;
      if (!shared) {
        shared = generateKit({ jd, companyUrl: company_url, days }, kitOptions);
        inFlight.set(fingerprint, shared);
      }

      let kit = await shared;
      if (reused) {
        // Research and questions are shared; the schedule never is. "Uses the days value given
        // for each case" — so it is rebuilt from this case's own number of days.
        kit = structuredClone(kit);
        kit.schedule = buildSchedule(kit.questions, kit.role.requirements, days);
      }
      return { id, status: "ok", kit, error: null };
    } catch (error) {
      // "Continues after one case fails, recording the failure rather than aborting the run."
      const known = error instanceof PipelineError;
      return {
        id,
        status: "failed",
        kit: null,
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < rawCases.length) {
      const index = next++;
      const entry = await runCase(rawCases[index], index);
      entries[index] = entry;
      done += 1;
      await onCaseDone?.(entry, { done, total: rawCases.length, output: snapshot() });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rawCases.length)) }, worker));

  return snapshot();
}
