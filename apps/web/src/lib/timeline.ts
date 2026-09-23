// Turns the pipeline's raw progress events into the rows of the generation timeline.
// Events arrive as "started" then "completed" / "skipped" / "failed" per step, from steps that
// run in parallel, so the same step appears more than once and the order is interleaved.

export interface ProgressEvent {
  step: string;
  status: "started" | "completed" | "skipped" | "failed";
  at: string;
  durationMs?: number;
  message?: string;
}

/** "stopped" is a step that had started when generation ended without it: a restart, or a fatal step elsewhere. */
export type StepState = "running" | "done" | "skipped" | "failed" | "stopped";

export interface TimelineStep {
  key: string;
  label: string;
  state: StepState;
  /** Why it was skipped or what went wrong, in the pipeline's own words. */
  detail?: string;
  durationMs?: number;
}

const LABELS: Record<string, string> = {
  validate_input: "Checking what you entered",
  jd_profile: "Reading the job description",
  crawl_company_site: "Reading the company's website",
  company_research: "Writing the company brief",
  public_discussion: "Looking for public discussion of their interviews",
  flashcards: "Writing flashcards",
  coverage_check: "Checking every requirement has a question",
  schedule: "Planning your days",
  validate_kit: "Checking the finished kit",
};

const words = (slug: string) => slug.replace(/[-_]/g, " ");

export function stepLabel(step: string): string {
  if (LABELS[step]) return LABELS[step];
  // A second or third pass, asked only for the requirements the previous one left uncovered.
  const repair = /^questions:repair_(\d+):(.+)$/.exec(step);
  if (repair) return `Closing a coverage gap: ${words(repair[2]!)} questions`;
  const category = /^questions:(.+)$/.exec(step);
  if (category) return `Writing ${words(category[1]!)} questions`;
  // A step added to the pipeline later still gets a readable row.
  const plain = words(step);
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

const STATE: Record<ProgressEvent["status"], StepState> = { started: "running", completed: "done", skipped: "skipped", failed: "failed" };

/** Rows in the order steps first appeared. `generating` is false once the kit is ready or failed. */
export function buildTimeline(progress: ProgressEvent[], generating: boolean): TimelineStep[] {
  const steps = new Map<string, TimelineStep>();
  for (const event of progress) {
    // The latest event for a step is its row. Setting a key a Map already holds keeps its
    // place, which is what keeps rows in the order steps first appeared.
    steps.set(event.step, {
      key: event.step,
      label: stepLabel(event.step),
      state: STATE[event.status],
      ...(event.message ? { detail: event.message } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
    });
  }
  const rows = [...steps.values()];
  // Nothing is running once generation has ended, whatever the last event said.
  return generating ? rows : rows.map((row) => (row.state === "running" ? { ...row, state: "stopped" } : row));
}
