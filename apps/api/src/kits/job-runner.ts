import { PipelineError } from "@prepkit/core";
import type { Kit, ProgressEvent } from "@prepkit/core";
import type { KitInput, KitRepository } from "./repository";

// Generation takes fifteen seconds or more and calls services that fail, so it never runs
// inside a request. A request records the kit as queued and returns at once; this runner does
// the work and writes every step to the database as it happens. The page polls the record —
// which is why a reload, or a second tab, shows the same progress.
//
// It is an in-process queue on purpose. One free instance is all there is; a separate worker
// and a message broker would be two more free-tier services to keep alive. What that costs is
// dealt with at startup: see failInterrupted.

export const DEFAULT_JOB_CONCURRENCY = 2;

export const INTERRUPTED = {
  code: "INTERRUPTED",
  message: "The server restarted while this kit was being generated. Try again to pick it up.",
};

/** The pipeline, as the runner sees it. server.ts binds this to generateKit and the model chain. */
export type GenerateFn = (input: KitInput, onProgress: (event: ProgressEvent) => void) => Promise<Kit>;

export interface JobRunnerOptions {
  kits: KitRepository;
  generate: GenerateFn;
  /** How many kits generate at once. The shared rate limiter paces the model calls underneath. */
  concurrency?: number;
  now?: () => Date;
  logError?: (message: string, error: unknown) => void;
}

export interface JobRunner {
  enqueue(kitId: string): void;
  /** Resolves when nothing is queued or running. For tests and for a clean shutdown. */
  idle(): Promise<void>;
  /** Call once at startup, before accepting requests. */
  failInterrupted(): Promise<number>;
}

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { kits, generate, concurrency = DEFAULT_JOB_CONCURRENCY, now = () => new Date(), logError = console.error } = options;
  const waiting: string[] = [];
  let active = 0;
  let whenIdle: (() => void)[] = [];

  async function run(kitId: string): Promise<void> {
    // Deleted while it waited in the queue, or already picked up: nothing to do. Claiming is
    // one atomic step, so two free slots can never both start the same kit.
    const record = await kits.claim(kitId, now());
    if (!record) return;

    // Steps run in parallel and report as they finish, but the log must read in order, so the
    // writes are chained rather than fired off together.
    let writes: Promise<void> = Promise.resolve();
    const onProgress = (event: ProgressEvent) => {
      writes = writes.then(() => kits.appendProgress(kitId, event, now())).catch((error) => logError(`[jobs] could not save progress for ${kitId}`, error));
    };

    try {
      const kit = await generate(record.input, onProgress);
      await writes;
      await kits.markReady(kitId, kit, now());
    } catch (error) {
      await writes;
      if (error instanceof PipelineError) {
        await kits.markFailed(kitId, { code: error.code, message: error.message }, now());
      } else {
        // A bug. The user gets a plain sentence; the details go to the log.
        logError(`[jobs] unexpected error generating kit ${kitId}`, error);
        await kits.markFailed(kitId, { code: "INTERNAL_ERROR", message: "Something went wrong while generating this kit. Please try again." }, now());
      }
    }
  }

  function pump(): void {
    while (active < concurrency && waiting.length > 0) {
      const kitId = waiting.shift()!;
      active += 1;
      run(kitId)
        .catch((error) => logError(`[jobs] job ${kitId} could not be recorded`, error))
        .finally(() => {
          active -= 1;
          pump();
        });
    }
    if (active === 0 && waiting.length === 0) {
      for (const resolve of whenIdle) resolve();
      whenIdle = [];
    }
  }

  return {
    enqueue(kitId) {
      waiting.push(kitId);
      pump();
    },
    idle() {
      return active === 0 && waiting.length === 0 ? Promise.resolve() : new Promise((resolve) => whenIdle.push(resolve));
    },
    // A queue in memory does not survive a restart, and free hosts restart. Whatever the last
    // process left queued or running will never finish, so it is marked failed with a reason
    // and a retry, instead of showing "generating…" forever.
    failInterrupted() {
      return kits.failUnfinished(INTERRUPTED, now());
    },
  };
}
