import { z } from 'zod';

// Field names and enum values below are the contract from Appendix A of the brief.
// Renaming any of them breaks the automated evaluation.

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'] as const;
export const PRIORITIES = ['must', 'nice'] as const;
export const QUESTION_CATEGORIES = [
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
] as const;

const httpUrl = z.url({ protocol: /^https?$/ });
// The brief only asks for stable ids. The r/q/f + counter format is our own rule:
// ids are assigned by code, never by the model, so anything else here is a bug.
const requirementId = z.string().regex(/^r\d+$/);
const questionId = z.string().regex(/^q\d+$/);
const flashcardId = z.string().regex(/^f\d+$/);

export const requirementSchema = z.object({
  id: requirementId,
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
});

export const questionSchema = z.object({
  id: questionId,
  // May be empty: a company-fit question need not map to a JD requirement.
  requirement_ids: z.array(requirementId),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.int().min(1).max(3),
});

export const flashcardSchema = z.object({
  id: flashcardId,
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(requirementId),
});

export const scheduleDaySchema = z.object({
  day: z.int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(questionId),
  minutes: z.int().positive(),
});

// Extensions (allowed by section 5). Top-level keys only, so every Appendix A
// object keeps exactly the shape the brief gives it.
export const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const researchLogEntrySchema = z.object({
  step: z.string().min(1),
  url: z.string().nullable(),
  outcome: z.enum(['ok', 'skipped', 'failed', 'empty']),
  reason: z.string().nullable(),
});

export const hiringProcessSchema = z.object({
  found: z.boolean(),
  stages: z.array(z.object({ name: z.string().min(1), description: z.string() })),
  source: httpUrl.nullable(),
});

export const publicDiscussionSchema = z.object({
  /** False when no search could be made: the company name was unknown, or the search failed. */
  searched: z.boolean(),
  source: z.string(),
  query: z.string(),
  hits: z.array(z.object({ title: z.string().min(1), url: httpUrl, excerpt: z.string().min(1), posted_at: z.iso.datetime() })),
});

const kitShape = z.object({
  source: z.object({
    // Empty string means "not stated" — never guessed.
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.int().min(0),
    researched_at: z.iso.datetime(),
    pages_used: z.array(httpUrl),
  }),
  company_brief: z.object({
    summary: z.string().min(1),
    what_they_do: z.string().min(1),
    sources: z.array(httpUrl),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string().min(1)),
    requirements: z.array(requirementSchema),
  }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.object({
    days_available: z.int().min(1),
    days: z.array(scheduleDaySchema),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(requirementId),
    passes: z.int().min(0),
  }),

  warnings: z.array(warningSchema).optional(),
  research_log: z.array(researchLogEntrySchema).optional(),
  hiring_process: hiringProcessSchema.optional(),
  public_discussion: publicDiscussionSchema.optional(),
  requirement_evidence: z.record(requirementId, z.string()).optional(),
});

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

// Shape alone is not enough: "every question_ids entry in the schedule must refer
// to a question that exists" and the schedule must span exactly days_available.
export const kitSchema = kitShape.superRefine((kit, ctx) => {
  const issue = (path: PropertyKey[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  const reqIds = kit.role.requirements.map((r) => r.id);
  const qIds = kit.questions.map((q) => q.id);
  const fIds = kit.flashcards.map((f) => f.id);

  for (const id of duplicates(reqIds)) issue(['role', 'requirements'], `duplicate requirement id ${id}`);
  for (const id of duplicates(qIds)) issue(['questions'], `duplicate question id ${id}`);
  for (const id of duplicates(fIds)) issue(['flashcards'], `duplicate flashcard id ${id}`);

  const reqSet = new Set(reqIds);
  const qSet = new Set(qIds);

  kit.questions.forEach((q, i) => {
    for (const id of q.requirement_ids) {
      if (!reqSet.has(id)) issue(['questions', i, 'requirement_ids'], `unknown requirement id ${id}`);
    }
  });
  kit.flashcards.forEach((f, i) => {
    for (const id of f.requirement_ids) {
      if (!reqSet.has(id)) issue(['flashcards', i, 'requirement_ids'], `unknown requirement id ${id}`);
    }
  });
  for (const id of kit.coverage.uncovered_requirement_ids) {
    if (!reqSet.has(id)) issue(['coverage', 'uncovered_requirement_ids'], `unknown requirement id ${id}`);
  }

  const { days, days_available } = kit.schedule;
  if (days.length !== days_available) {
    issue(['schedule', 'days'], `expected ${days_available} days, got ${days.length}`);
  }
  days.forEach((d, i) => {
    if (d.day !== i + 1) issue(['schedule', 'days', i, 'day'], `expected day ${i + 1}, got ${d.day}`);
    for (const id of d.question_ids) {
      if (!qSet.has(id)) issue(['schedule', 'days', i, 'question_ids'], `unknown question id ${id}`);
    }
  });
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type Warning = z.infer<typeof warningSchema>;
export type ResearchLogEntry = z.infer<typeof researchLogEntrySchema>;
export type HiringProcess = z.infer<typeof hiringProcessSchema>;
export type PublicDiscussion = z.infer<typeof publicDiscussionSchema>;
export type Kit = z.infer<typeof kitSchema>;

export type KitValidation =
  | { ok: true; kit: Kit }
  | { ok: false; issues: { path: string; message: string }[] };

export function validateKit(input: unknown): KitValidation {
  const result = kitSchema.safeParse(input);
  if (result.success) return { ok: true, kit: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
