import { checkCoverage } from "../coverage/coverage";
import type { DraftQuestion } from "../pipeline/steps/questions";
import { QUESTION_CATEGORIES, validateKit } from "../schema/kit";
import type { Flashcard, Kit, Question, ScheduleDay } from "../schema/kit";
import { MAX_MINUTES_PER_DAY, MINUTES_BY_DIFFICULTY, buildSchedule } from "../scheduling/schedule";
import type { Emphasis } from "../scheduling/schedule";

// The builder's rules. A kit arrives as a draft and the user reshapes it; regenerating one
// section must not discard work done anywhere else, and must not discard a question the user
// wrote or changed even inside the section being regenerated.
//
// Everything here is a pure function: (state, change) -> new state. No database, no HTTP, no
// model. The API loads a kit, applies one of these, and saves; the rules can be read and
// tested on their own.
//
// WHAT IS TRACKED, per item, beside the kit (never inside it, so the kit keeps Appendix A's shape):
//   origin  "generated" — written by the pipeline      "user" — added by hand
//   edited  the user changed its content
//   pinned  the user said "keep this one", without changing it
//
// THE RULE: an item is LOCKED if origin is "user", or it is edited, or it is pinned.
// Regeneration replaces unlocked items of the section asked for, and touches nothing else.

export type Origin = "generated" | "user";

export interface ItemMeta {
  origin: Origin;
  edited: boolean;
  pinned: boolean;
}

export interface KitMeta {
  /** Keyed by item id ("q7", "f3") or by brief field ("brief.summary", "brief.what_they_do"). */
  items: Record<string, ItemMeta>;
  /** Ids are never reused, so a schedule or a practice record can never point at a different question. */
  nextQuestion: number;
  nextFlashcard: number;
  /** Once the user has arranged the schedule by hand it is patched, never silently rebuilt. */
  scheduleEdited: boolean;
}

export interface EditableKit {
  kit: Kit;
  meta: KitMeta;
}

export type BriefField = "summary" | "what_they_do";
export type DraftFlashcard = Omit<Flashcard, "id">;

export class KitEditError extends Error {
  constructor(
    readonly code: "ITEM_NOT_FOUND" | "INVALID_EDIT",
    message: string,
  ) {
    super(message);
    this.name = "KitEditError";
  }
}

const MAX_SCHEDULE_DAYS = 365;
const GENERATED: ItemMeta = { origin: "generated", edited: false, pinned: false };
const numberIn = (id: string) => Number(id.slice(1)) || 0;

export const metaOf = (meta: KitMeta, key: string): ItemMeta => meta.items[key] ?? GENERATED;
export const isLocked = (item: ItemMeta): boolean => item.origin === "user" || item.edited || item.pinned;

/** The state of a kit straight out of the pipeline: everything generated, nothing touched. */
export function initialMeta(kit: Kit): KitMeta {
  const items: Record<string, ItemMeta> = {};
  for (const item of [...kit.questions, ...kit.flashcards]) items[item.id] = { ...GENERATED };
  return {
    items,
    nextQuestion: Math.max(0, ...kit.questions.map((q) => numberIn(q.id))) + 1,
    nextFlashcard: Math.max(0, ...kit.flashcards.map((f) => numberIn(f.id))) + 1,
    scheduleEdited: false,
  };
}

// --- shared machinery ---------------------------------------------------------------------

const copy = (state: EditableKit): EditableKit => structuredClone(state);
const samePrompt = (a: string, b: string) => a.toLowerCase().replace(/\W+/g, " ").trim() === b.toLowerCase().replace(/\W+/g, " ").trim();

function question(state: EditableKit, id: string): Question {
  const found = state.kit.questions.find((q) => q.id === id);
  if (!found) throw new KitEditError("ITEM_NOT_FOUND", `There is no question ${id} in this kit`);
  return found;
}

function flashcard(state: EditableKit, id: string): Flashcard {
  const found = state.kit.flashcards.find((f) => f.id === id);
  if (!found) throw new KitEditError("ITEM_NOT_FOUND", `There is no flashcard ${id} in this kit`);
  return found;
}

function touch(state: EditableKit, key: string, change: Partial<ItemMeta>): void {
  state.meta.items[key] = { ...metaOf(state.meta, key), ...change };
}

/**
 * Keeps the schedule true to the questions. Untouched by the user, it is simply rebuilt by
 * the allocator. Arranged by hand, it is patched as little as possible: ids that no longer
 * exist are taken out, and new questions go to whichever day is lightest.
 */
function syncSchedule(state: EditableKit): void {
  const { kit, meta } = state;
  if (!meta.scheduleEdited) {
    kit.schedule = buildSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available);
    return;
  }

  const existing = new Set(kit.questions.map((q) => q.id));
  for (const day of kit.schedule.days) day.question_ids = day.question_ids.filter((id) => existing.has(id));

  const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
  for (const q of kit.questions) {
    if (scheduled.has(q.id)) continue;
    const lightest = kit.schedule.days.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    lightest.question_ids.push(q.id);
    lightest.minutes = Math.min(lightest.minutes + (MINUTES_BY_DIFFICULTY[q.difficulty] ?? 15), MAX_MINUTES_PER_DAY);
  }
}

/** Every operation ends here: coverage recomputed from what the kit now contains, and the whole kit re-validated. */
function finish(state: EditableKit): EditableKit {
  state.kit.coverage = {
    uncovered_requirement_ids: checkCoverage(state.kit.role.requirements, state.kit.questions).uncovered,
    passes: state.kit.coverage.passes,
  };
  const checked = validateKit(state.kit);
  if (!checked.ok) {
    const problems = checked.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new KitEditError("INVALID_EDIT", `That change would make the kit invalid: ${problems}`);
  }
  return { kit: checked.kit, meta: state.meta };
}

function checkDraftQuestion(state: EditableKit, draft: Partial<DraftQuestion>): void {
  const known = new Set(state.kit.role.requirements.map((r) => r.id));
  const unknown = (draft.requirement_ids ?? []).filter((id) => !known.has(id));
  if (unknown.length > 0) throw new KitEditError("INVALID_EDIT", `Unknown requirement id(s): ${unknown.join(", ")}`);
  if (draft.category !== undefined && !QUESTION_CATEGORIES.includes(draft.category)) {
    throw new KitEditError("INVALID_EDIT", `Unknown category: ${String(draft.category)}`);
  }
}

// --- questions ----------------------------------------------------------------------------

/** Changing a question's text, difficulty, requirements or category makes it the user's. */
export function editQuestion(input: EditableKit, id: string, patch: Partial<DraftQuestion>): EditableKit {
  const state = copy(input);
  checkDraftQuestion(state, patch);
  Object.assign(question(state, id), patch);
  touch(state, id, { edited: true });
  syncSchedule(state);
  return finish(state);
}

export function addQuestion(input: EditableKit, draft: DraftQuestion): EditableKit & { id: string } {
  const state = copy(input);
  checkDraftQuestion(state, draft);
  const id = `q${state.meta.nextQuestion++}`;
  state.kit.questions.push({ id, ...draft });
  state.meta.items[id] = { origin: "user", edited: false, pinned: false };
  syncSchedule(state);
  return { ...finish(state), id };
}

export function deleteQuestion(input: EditableKit, id: string): EditableKit {
  const state = copy(input);
  question(state, id);
  state.kit.questions = state.kit.questions.filter((q) => q.id !== id);
  delete state.meta.items[id];
  syncSchedule(state);
  return finish(state);
}

/**
 * Takes the complete new order of question ids. Order is presentation, not content, so
 * reordering does not lock anything.
 */
export function reorderQuestions(input: EditableKit, orderedIds: string[]): EditableKit {
  const state = copy(input);
  const byId = new Map(state.kit.questions.map((q) => [q.id, q]));
  const isPermutation = orderedIds.length === byId.size && new Set(orderedIds).size === byId.size && orderedIds.every((id) => byId.has(id));
  if (!isPermutation) throw new KitEditError("INVALID_EDIT", "The new order must list every question in the kit exactly once");
  state.kit.questions = orderedIds.map((id) => byId.get(id)!);
  return finish(state);
}

// --- flashcards ---------------------------------------------------------------------------

export function editFlashcard(input: EditableKit, id: string, patch: Partial<DraftFlashcard>): EditableKit {
  const state = copy(input);
  checkDraftQuestion(state, { requirement_ids: patch.requirement_ids });
  Object.assign(flashcard(state, id), patch);
  touch(state, id, { edited: true });
  return finish(state);
}

export function addFlashcard(input: EditableKit, draft: DraftFlashcard): EditableKit & { id: string } {
  const state = copy(input);
  checkDraftQuestion(state, { requirement_ids: draft.requirement_ids });
  const id = `f${state.meta.nextFlashcard++}`;
  state.kit.flashcards.push({ id, ...draft });
  state.meta.items[id] = { origin: "user", edited: false, pinned: false };
  return { ...finish(state), id };
}

export function deleteFlashcard(input: EditableKit, id: string): EditableKit {
  const state = copy(input);
  flashcard(state, id);
  state.kit.flashcards = state.kit.flashcards.filter((f) => f.id !== id);
  delete state.meta.items[id];
  return finish(state);
}

export function reorderFlashcards(input: EditableKit, orderedIds: string[]): EditableKit {
  const state = copy(input);
  const byId = new Map(state.kit.flashcards.map((f) => [f.id, f]));
  const isPermutation = orderedIds.length === byId.size && new Set(orderedIds).size === byId.size && orderedIds.every((id) => byId.has(id));
  if (!isPermutation) throw new KitEditError("INVALID_EDIT", "The new order must list every flashcard in the kit exactly once");
  state.kit.flashcards = orderedIds.map((id) => byId.get(id)!);
  return finish(state);
}

// --- pinning, the brief, the schedule -----------------------------------------------------

/** "Keep this one" for a generated item the user likes as it is. */
export function setPinned(input: EditableKit, id: string, pinned: boolean): EditableKit {
  const state = copy(input);
  if (id.startsWith("q")) question(state, id);
  else flashcard(state, id);
  touch(state, id, { pinned });
  return finish(state);
}

/**
 * Whether an item counts as changed by the user. Cleared after an undo has put it back as the
 * model wrote it, so a regeneration may replace it again. Brief fields are keyed "brief.<field>".
 */
export function setEdited(input: EditableKit, id: string, edited: boolean): EditableKit {
  const state = copy(input);
  if (id.startsWith("brief.")) {
    if (!["summary", "what_they_do"].includes(id.slice("brief.".length))) throw new KitEditError("ITEM_NOT_FOUND", `There is no brief field ${id}`);
  } else if (id.startsWith("q")) question(state, id);
  else flashcard(state, id);
  touch(state, id, { edited });
  return finish(state);
}

export function editBrief(input: EditableKit, field: BriefField, value: string): EditableKit {
  const state = copy(input);
  state.kit.company_brief[field] = value.trim();
  touch(state, `brief.${field}`, { edited: true });
  return finish(state);
}

/** Moving questions between days, or changing a day's focus or minutes, makes the schedule the user's. */
export function editScheduleDay(input: EditableKit, dayNumber: number, patch: Partial<Pick<ScheduleDay, "focus" | "minutes" | "question_ids">>): EditableKit {
  const state = copy(input);
  const day = state.kit.schedule.days.find((d) => d.day === dayNumber);
  if (!day) throw new KitEditError("ITEM_NOT_FOUND", `There is no day ${dayNumber} in this schedule`);
  Object.assign(day, patch);
  state.meta.scheduleEdited = true;
  return finish(state);
}

// --- regeneration: the three merges -------------------------------------------------------

export interface RegenerationResult extends EditableKit {
  kept: string[];
  removed: string[];
  added: string[];
}

/**
 * Regenerating one question category. Locked questions in that category stay exactly as they
 * are, in place. Unlocked ones are replaced by the fresh questions, which get new ids. Every
 * other category, the flashcards and the brief are not touched. A fresh question that
 * repeats one that was kept is dropped.
 *
 * `input` must be the kit as it is NOW, not as it was when the model was asked: an edit made
 * while the model was thinking is then simply one more locked item.
 */
export function mergeRegeneratedCategory(input: EditableKit, category: Question["category"], fresh: DraftQuestion[]): RegenerationResult {
  const state = copy(input);
  const inCategory = state.kit.questions.filter((q) => q.category === category);
  const kept = inCategory.filter((q) => isLocked(metaOf(state.meta, q.id)));
  const removed = inCategory.filter((q) => !isLocked(metaOf(state.meta, q.id))).map((q) => q.id);

  const additions: Question[] = [];
  for (const draft of fresh) {
    if ([...kept, ...additions].some((q) => samePrompt(q.prompt, draft.prompt))) continue;
    checkDraftQuestion(state, draft);
    const id = `q${state.meta.nextQuestion++}`;
    additions.push({ ...draft, id, category });
    state.meta.items[id] = { ...GENERATED };
  }

  // Fresh questions go where the category's last question was, so the list keeps its shape.
  const gone = new Set(removed);
  const lastOfCategory = state.kit.questions.map((q) => q.category).lastIndexOf(category);
  const insertAt = lastOfCategory === -1 ? state.kit.questions.length : lastOfCategory + 1;
  state.kit.questions = [...state.kit.questions.slice(0, insertAt), ...additions, ...state.kit.questions.slice(insertAt)].filter((q) => !gone.has(q.id));
  for (const id of removed) delete state.meta.items[id];

  syncSchedule(state);
  return { ...finish(state), kept: kept.map((q) => q.id), removed, added: additions.map((q) => q.id) };
}

/** Regenerating the brief replaces only the fields the user has not rewritten. */
export function mergeRegeneratedBrief(input: EditableKit, fresh: Kit["company_brief"]): EditableKit & { replaced: BriefField[] } {
  const state = copy(input);
  const replaced: BriefField[] = [];
  for (const field of ["summary", "what_they_do"] as const) {
    if (isLocked(metaOf(state.meta, `brief.${field}`))) continue;
    state.kit.company_brief[field] = fresh[field];
    replaced.push(field);
  }
  // Sources describe where generated text came from, so they follow it.
  if (replaced.length > 0) state.kit.company_brief.sources = fresh.sources;
  return { ...finish(state), replaced };
}

/**
 * Regenerating the schedule is the one regeneration that does discard the user's work — it is
 * what the button says — so the interface confirms first. It can also change the number of
 * days, which is how a kit is re-planned for a different interview date without generating
 * anything again.
 */
/**
 * A full recompute, the one explicit discard of a hand-arranged schedule. With `emphasis`
 * (from practice, see scheduling/adaptive.ts) the recompute leans toward weak requirements.
 */
export function regenerateSchedule(input: EditableKit, days?: number, emphasis?: Emphasis): EditableKit {
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > MAX_SCHEDULE_DAYS)) {
    throw new KitEditError("INVALID_EDIT", `Days must be a whole number from 1 to ${MAX_SCHEDULE_DAYS}`);
  }
  const state = copy(input);
  state.kit.schedule = buildSchedule(state.kit.questions, state.kit.role.requirements, days ?? state.kit.schedule.days_available, emphasis);
  state.meta.scheduleEdited = false;
  return finish(state);
}
