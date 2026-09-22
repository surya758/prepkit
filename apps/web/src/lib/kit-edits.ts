import type { ItemMeta, Kit, KitMeta, Question } from "@prepkit/core";

export interface KitState {
  kit: Kit;
  meta: KitMeta;
}

export type QuestionDraft = Omit<Question, "id" | "category">;

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
  patch: Partial<QuestionDraft>,
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
