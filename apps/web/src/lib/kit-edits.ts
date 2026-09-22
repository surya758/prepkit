import type { Flashcard, ItemMeta, Kit, KitMeta, Question, ScheduleDay } from "@prepkit/core";

export interface KitState {
  kit: Kit;
  meta: KitMeta;
}

export type QuestionDraft = Omit<Question, "id" | "category">;
type QuestionPatch = Partial<QuestionDraft> & { category?: Question["category"] };
export type FlashcardDraft = Omit<Flashcard, "id">;
export type DayPatch = Partial<Pick<ScheduleDay, "focus" | "minutes" | "question_ids">>;

const GENERATED: ItemMeta = {
  origin: "generated",
  edited: false,
  pinned: false,
};
const itemMeta = (meta: KitMeta, id: string): ItemMeta =>
  meta.items[id] ?? GENERATED;
const withItem = (
  meta: KitMeta,
  id: string,
  change: Partial<ItemMeta>,
): KitMeta => ({
  ...meta,
  items: { ...meta.items, [id]: { ...itemMeta(meta, id), ...change } },
});

export function editQuestion(
  { kit, meta }: KitState,
  id: string,
  patch: QuestionPatch,
): KitState {
  return {
    kit: {
      ...kit,
      questions: kit.questions.map((q) =>
        q.id === id ? { ...q, ...patch } : q,
      ),
    },
    meta: withItem(meta, id, { edited: true }),
  };
}

/** Ids are never reused: the next number, whatever has been deleted. The new question is the user's. */
export function addQuestion(
  { kit, meta }: KitState,
  category: Question["category"],
  draft: QuestionDraft,
): KitState & { id: string } {
  const id = `q${meta.nextQuestion}`;
  return {
    id,
    kit: { ...kit, questions: [...kit.questions, { id, category, ...draft }] },
    meta: {
      ...withItem(meta, id, { origin: "user", edited: false, pinned: false }),
      nextQuestion: meta.nextQuestion + 1,
    },
  };
}

export function deleteQuestion({ kit, meta }: KitState, id: string): KitState {
  const items = { ...meta.items };
  delete items[id];
  return {
    kit: { ...kit, questions: kit.questions.filter((q) => q.id !== id) },
    meta: { ...meta, items },
  };
}

export function setPinned(
  { kit, meta }: KitState,
  id: string,
  pinned: boolean,
): KitState {
  return { kit, meta: withItem(meta, id, { pinned }) };
}

/**
 * Reorders the questions of one category. Order is presentation, not content, so nothing is
 * marked edited. Questions in other categories keep their places, so the list can be
 * reordered one category at a time.
 */
export function reorderQuestions({ kit, meta }: KitState, orderedIds: string[]): KitState {
  const byId = new Map(kit.questions.map((q) => [q.id, q]));
  const moving = new Set(orderedIds);
  let next = 0;
  // Walk the list; each slot that held one of the moving questions takes the next id in the new order.
  return { kit: { ...kit, questions: kit.questions.map((q) => (moving.has(q.id) ? byId.get(orderedIds[next++]!)! : q)) }, meta };
}

/** What the server is sent: it takes the order of every question in the kit, exactly once. */
export const fullOrder = (state: KitState, orderedIds: string[]): string[] => reorderQuestions(state, orderedIds).kit.questions.map((q) => q.id);

/**
 * Changing a question's category is an edit, nothing more: the question keeps its place in the
 * kit's list, exactly as core's editQuestion leaves it, and so appears in its new category at
 * whatever position that place gives it. Moving it to the end as well would be a second change
 * the server does not make, and the page would show one order and then the other.
 */
export function moveQuestion(state: KitState, id: string, category: Question["category"]): KitState {
  return editQuestion(state, id, { category });
}

// --- flashcards: the same rules, on one flat list ------------------------------------------

export function editFlashcard({ kit, meta }: KitState, id: string, patch: Partial<FlashcardDraft>): KitState {
  return {
    kit: { ...kit, flashcards: kit.flashcards.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
    meta: withItem(meta, id, { edited: true }),
  };
}

export function addFlashcard({ kit, meta }: KitState, draft: FlashcardDraft): KitState & { id: string } {
  const id = `f${meta.nextFlashcard}`;
  return {
    id,
    kit: { ...kit, flashcards: [...kit.flashcards, { id, ...draft }] },
    meta: { ...withItem(meta, id, { origin: "user", edited: false, pinned: false }), nextFlashcard: meta.nextFlashcard + 1 },
  };
}

export function deleteFlashcard({ kit, meta }: KitState, id: string): KitState {
  const items = { ...meta.items };
  delete items[id];
  return { kit: { ...kit, flashcards: kit.flashcards.filter((f) => f.id !== id) }, meta: { ...meta, items } };
}

/** Flashcards are one list, so the order given is the whole order. */
export function reorderFlashcards({ kit, meta }: KitState, orderedIds: string[]): KitState {
  const byId = new Map(kit.flashcards.map((f) => [f.id, f]));
  return { kit: { ...kit, flashcards: orderedIds.map((id) => byId.get(id)!) }, meta };
}

// --- the schedule ---------------------------------------------------------------------------

/** A day arranged by hand. From then on the schedule is only patched by other edits, never rebuilt. */
export function editScheduleDay({ kit, meta }: KitState, dayNumber: number, patch: DayPatch): KitState {
  return {
    kit: { ...kit, schedule: { ...kit.schedule, days: kit.schedule.days.map((d) => (d.day === dayNumber ? { ...d, ...patch } : d)) } },
    meta: { ...meta, scheduleEdited: true },
  };
}
