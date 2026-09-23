import { describe, expect, it } from "vitest";
import {
  KitEditError,
  addFlashcard,
  addQuestion,
  deleteFlashcard,
  deleteQuestion,
  editBrief,
  editFlashcard,
  editQuestion,
  editScheduleDay,
  initialMeta,
  revertBrief,
  revertFlashcard,
  revertQuestion,
  setEdited,
  isLocked,
  mergeRegeneratedBrief,
  mergeRegeneratedCategory,
  metaOf,
  regenerateSchedule,
  reorderFlashcards,
  reorderQuestions,
  setPinned,
  validateKit,
} from "../src";
import type { DraftQuestion, EditableKit, Kit, Question } from "../src";
import { makeKit } from "./fixtures/kit";

const q = (id: string, category: Question["category"], prompt: string, requirement_ids: string[] = [], difficulty = 2): Question => ({
  id,
  category,
  prompt,
  requirement_ids,
  difficulty,
  answer_outline: "An outline.",
});

/** A kit as it comes out of the pipeline: three technical, two behavioural, one company-fit question. */
function freshKit(): EditableKit {
  const kit: Kit = makeKit();
  kit.questions = [
    q("q1", "technical", "Where should state live in a React app?", ["r1"], 3),
    q("q2", "technical", "How does reconciliation work?", ["r1"]),
    q("q3", "technical", "What are React keys for?", ["r1"], 1),
    q("q4", "behavioural", "Tell me about mentoring a junior engineer.", ["r2"]),
    q("q5", "behavioural", "Describe a disagreement with a teammate.", ["r2"]),
    q("q6", "company-fit", "Why logistics software, and why Acme?"),
  ];
  kit.flashcards = [
    { id: "f1", front: "useMemo vs useCallback", back: "Value vs function identity.", requirement_ids: ["r1"] },
    { id: "f2", front: "What does Acme build?", back: "Route planning software.", requirement_ids: [] },
  ];
  kit.schedule = { days_available: 3, days: [] };
  const state = regenerateSchedule({ kit, meta: initialMeta(kit) });
  return state;
}

const draft = (prompt: string, requirement_ids = ["r1"], category: Question["category"] = "technical"): DraftQuestion => ({
  category,
  prompt,
  requirement_ids,
  difficulty: 2,
  answer_outline: "A fresh outline.",
});

const prompts = (state: EditableKit, category?: Question["category"]) =>
  state.kit.questions.filter((x) => !category || x.category === category).map((x) => x.prompt);
const scheduledIds = (state: EditableKit) => state.kit.schedule.days.flatMap((d) => d.question_ids).sort();

describe("the state model", () => {
  it("starts with everything generated and nothing locked, and counters past the highest id", () => {
    const { meta } = freshKit();
    expect(meta.items.q1).toEqual({ origin: "generated", edited: false, pinned: false });
    expect(Object.values(meta.items).some(isLocked)).toBe(false);
    expect(meta).toMatchObject({ nextQuestion: 7, nextFlashcard: 3, scheduleEdited: false });
  });

  it.each([
    [{ origin: "generated", edited: false, pinned: false }, false],
    [{ origin: "generated", edited: true, pinned: false }, true],
    [{ origin: "generated", edited: false, pinned: true }, true],
    [{ origin: "user", edited: false, pinned: false }, true],
  ] as const)("locks %j -> %s", (item, locked) => {
    expect(isLocked(item)).toBe(locked);
  });

  it("never stores its bookkeeping inside the kit, so the kit keeps the structure the brief requires", () => {
    const state = setPinned(editQuestion(freshKit(), "q1", { prompt: "Rewritten by me" }), "q2", true);
    expect(JSON.stringify(state.kit)).not.toMatch(/origin|pinned|edited/);
    expect(validateKit(state.kit)).toMatchObject({ ok: true });
  });

  it("never changes the state it was given", () => {
    const before = freshKit();
    const snapshot = structuredClone(before);
    editQuestion(before, "q1", { prompt: "Changed" });
    deleteQuestion(before, "q2");
    mergeRegeneratedCategory(before, "technical", [draft("Something new?")]);
    expect(before).toEqual(snapshot);
  });
});

describe("regenerating a question category", () => {
  it("replaces untouched questions in that category, and leaves every other category alone", () => {
    const before = freshKit();
    const after = mergeRegeneratedCategory(before, "technical", [draft("How do you profile a slow render?"), draft("When is useEffect the wrong tool?")]);

    expect(prompts(after, "technical")).toEqual(["How do you profile a slow render?", "When is useEffect the wrong tool?"]);
    expect(prompts(after, "behavioural")).toEqual(prompts(before, "behavioural"));
    expect(prompts(after, "company-fit")).toEqual(prompts(before, "company-fit"));
    expect(after.kit.flashcards).toEqual(before.kit.flashcards);
    expect(after.kit.company_brief).toEqual(before.kit.company_brief);
    expect(after).toMatchObject({ kept: [], removed: ["q1", "q2", "q3"], added: ["q7", "q8"] });
  });

  it("keeps a question the user EDITED, even though it is in the category being regenerated", () => {
    const edited = editQuestion(freshKit(), "q2", { prompt: "How does reconciliation work, and when does it get it wrong?" });
    const after = mergeRegeneratedCategory(edited, "technical", [draft("A fresh question?")]);

    expect(prompts(after, "technical")).toEqual(["How does reconciliation work, and when does it get it wrong?", "A fresh question?"]);
    expect(after.kept).toEqual(["q2"]);
    expect(after.kit.questions.find((x) => x.id === "q2")).toBeDefined(); // same id, so practice history still points at it
  });

  it("keeps a question the user WROTE, even though it is in the category being regenerated", () => {
    const added = addQuestion(freshKit(), draft("My own question about our migration to hooks?"));
    const after = mergeRegeneratedCategory(added, "technical", [draft("A fresh question?")]);

    expect(prompts(after, "technical")).toContain("My own question about our migration to hooks?");
    expect(metaOf(after.meta, added.id)).toMatchObject({ origin: "user" });
    expect(after.removed).toEqual(["q1", "q2", "q3"]);
  });

  it("keeps a question the user PINNED without changing it, and lets it go again once unpinned", () => {
    const pinned = setPinned(freshKit(), "q3", true);
    expect(prompts(mergeRegeneratedCategory(pinned, "technical", [draft("Fresh?")]), "technical")).toEqual(["What are React keys for?", "Fresh?"]);

    const unpinned = setPinned(pinned, "q3", false);
    expect(prompts(mergeRegeneratedCategory(unpinned, "technical", [draft("Fresh?")]), "technical")).toEqual(["Fresh?"]);
  });

  it("keeps edits made in OTHER sections: a rewritten behavioural question, a rewritten brief, an edited flashcard", () => {
    let state = freshKit();
    state = editQuestion(state, "q4", { prompt: "Tell me about mentoring someone who then outgrew you." });
    state = editBrief(state, "summary", "My own notes on Acme.");
    state = editFlashcard(state, "f1", { back: "My own wording." });

    const after = mergeRegeneratedCategory(state, "technical", [draft("Fresh?")]);

    expect(prompts(after, "behavioural")[0]).toBe("Tell me about mentoring someone who then outgrew you.");
    expect(after.kit.company_brief.summary).toBe("My own notes on Acme.");
    expect(after.kit.flashcards[0]!.back).toBe("My own wording.");
  });

  it("survives an edit made WHILE the model was generating, because the merge runs on the kit as it is now", () => {
    const whenTheModelWasAsked = freshKit();
    // ...forty seconds pass, during which the user edits q1 and adds a question of their own...
    let now = editQuestion(whenTheModelWasAsked, "q1", { prompt: "Edited while regenerating" });
    now = addQuestion(now, draft("Added while regenerating?"));

    const after = mergeRegeneratedCategory(now, "technical", [draft("The model's fresh question?")]);

    expect(prompts(after, "technical")).toEqual(["Edited while regenerating", "Added while regenerating?", "The model's fresh question?"]);
  });

  it("never reuses an id, so nothing that pointed at an old question can point at a new one", () => {
    const once = mergeRegeneratedCategory(freshKit(), "technical", [draft("First fresh?")]);
    const twice = mergeRegeneratedCategory(once, "technical", [draft("Second fresh?")]);
    expect(once.added).toEqual(["q7"]);
    expect(twice.added).toEqual(["q8"]);
    expect(twice.kit.questions.map((x) => x.id)).not.toContain("q1");
  });

  it("drops a fresh question that repeats one that was kept", () => {
    const pinned = setPinned(freshKit(), "q3", true);
    const after = mergeRegeneratedCategory(pinned, "technical", [draft("what are React keys for"), draft("Genuinely new?")]);
    expect(prompts(after, "technical")).toEqual(["What are React keys for?", "Genuinely new?"]);
  });

  it("files fresh questions under the regenerated category, whatever the model called them", () => {
    const after = mergeRegeneratedCategory(freshKit(), "behavioural", [draft("Tell me about a time you owned a failure.", ["r2"], "technical")]);
    expect(after.kit.questions.find((x) => x.id === after.added[0])!.category).toBe("behavioural");
  });

  it("keeps the list's shape: fresh questions take the category's place rather than going to the end", () => {
    const after = mergeRegeneratedCategory(freshKit(), "technical", [draft("Fresh?")]);
    expect(after.kit.questions.map((x) => x.category)).toEqual(["technical", "behavioural", "behavioural", "company-fit"]);
  });

  it("reports a must-have that lost its only question, instead of hiding it", () => {
    const after = mergeRegeneratedCategory(freshKit(), "behavioural", []);
    expect(after.kit.coverage.uncovered_requirement_ids).toContain("r2");
  });

  it("rejects fresh questions that cite a requirement the kit does not have", () => {
    expect(() => mergeRegeneratedCategory(freshKit(), "technical", [draft("Fresh?", ["r99"])])).toThrow(KitEditError);
  });
});

describe("the schedule follows the questions", () => {
  it("is rebuilt after a regeneration while the user has not arranged it, and never points at a removed question", () => {
    const after = mergeRegeneratedCategory(freshKit(), "technical", [draft("Fresh one?"), draft("Fresh two?")]);
    expect(scheduledIds(after)).toEqual(after.kit.questions.map((x) => x.id).sort());
    expect(after.kit.schedule.days).toHaveLength(3);
  });

  it("is only patched once the user has arranged it: their days stay, removed ids go, new ones join the lightest day", () => {
    let state = freshKit();
    const day2 = state.kit.schedule.days[1]!;
    state = editScheduleDay(state, 2, { focus: "My deep-dive day", minutes: 200, question_ids: [...day2.question_ids] });
    expect(state.meta.scheduleEdited).toBe(true);

    const after = mergeRegeneratedCategory(state, "technical", [draft("Fresh?")]);

    expect(after.kit.schedule.days[1]!.focus).toBe("My deep-dive day");
    expect(scheduledIds(after)).toEqual(after.kit.questions.map((x) => x.id).sort());
    expect(after.kit.schedule.days[1]!.question_ids).not.toContain(after.added[0]); // day 2 is the heaviest
  });

  it("discards the user's arrangement only when they ask for the schedule itself to be regenerated", () => {
    const arranged = editScheduleDay(freshKit(), 1, { focus: "Mine" });
    const after = regenerateSchedule(arranged);
    expect(after.meta.scheduleEdited).toBe(false);
    expect(after.kit.schedule.days[0]!.focus).not.toBe("Mine");
  });

  it("re-plans the same questions over a different number of days, without generating anything", () => {
    const before = freshKit();
    const after = regenerateSchedule(before, 10);
    expect(after.kit.schedule).toMatchObject({ days_available: 10 });
    expect(after.kit.schedule.days).toHaveLength(10);
    expect(after.kit.questions).toEqual(before.kit.questions);
  });

  it.each([0, 2.5, 400])("refuses %j days", (days) => {
    expect(() => regenerateSchedule(freshKit(), days)).toThrow("Days must be a whole number from 1 to 365");
  });

  it("refuses a schedule edit that points at a question that does not exist", () => {
    expect(() => editScheduleDay(freshKit(), 1, { question_ids: ["q1", "q404"] })).toThrow(/unknown question id q404/);
    expect(() => editScheduleDay(freshKit(), 9, { focus: "x" })).toThrow("There is no day 9 in this schedule");
  });
});

describe("regenerating the brief", () => {
  const fresh = { summary: "A fresh summary.", what_they_do: "A fresh description.", sources: ["https://acme.example/about"] };

  it("replaces both fields, and the sources, when the user has rewritten neither", () => {
    const after = mergeRegeneratedBrief(freshKit(), fresh);
    expect(after.kit.company_brief).toEqual(fresh);
    expect(after.replaced).toEqual(["summary", "what_they_do"]);
  });

  it("replaces only the field the user has not rewritten", () => {
    const edited = editBrief(freshKit(), "summary", "  My own summary.  ");
    const after = mergeRegeneratedBrief(edited, fresh);
    expect(after.kit.company_brief).toMatchObject({ summary: "My own summary.", what_they_do: "A fresh description." });
    expect(after.replaced).toEqual(["what_they_do"]);
  });

  it("changes nothing, sources included, when the user has rewritten both", () => {
    const before = editBrief(editBrief(freshKit(), "summary", "Mine."), "what_they_do", "Also mine.");
    const after = mergeRegeneratedBrief(before, fresh);
    expect(after.kit.company_brief).toEqual(before.kit.company_brief);
    expect(after.replaced).toEqual([]);
  });

  it("does not touch the questions", () => {
    const before = freshKit();
    expect(mergeRegeneratedBrief(before, fresh).kit.questions).toEqual(before.kit.questions);
  });
});

describe("editing questions", () => {
  it("applies the change and marks the question edited", () => {
    const after = editQuestion(freshKit(), "q1", { prompt: "Rewritten", difficulty: 1 });
    expect(after.kit.questions[0]).toMatchObject({ id: "q1", prompt: "Rewritten", difficulty: 1 });
    expect(metaOf(after.meta, "q1")).toEqual({ origin: "generated", edited: true, pinned: false });
  });

  it("treats moving a question to another category as an edit", () => {
    const after = editQuestion(freshKit(), "q3", { category: "system-design" });
    expect(after.kit.questions.find((x) => x.id === "q3")!.category).toBe("system-design");
    expect(isLocked(metaOf(after.meta, "q3"))).toBe(true);
    expect(prompts(mergeRegeneratedCategory(after, "technical", []), "system-design")).toEqual(["What are React keys for?"]); // it left the category, so it is safe
  });

  it("adds a question as the user's own, with the next id, and schedules it", () => {
    const after = addQuestion(freshKit(), draft("My question?"));
    expect(after.id).toBe("q7");
    expect(metaOf(after.meta, "q7")).toEqual({ origin: "user", edited: false, pinned: false });
    expect(scheduledIds(after)).toContain("q7");
  });

  it("deletes a question everywhere: the list, the bookkeeping and the schedule", () => {
    const after = deleteQuestion(freshKit(), "q4");
    expect(after.kit.questions.map((x) => x.id)).not.toContain("q4");
    expect(after.meta.items.q4).toBeUndefined();
    expect(scheduledIds(after)).not.toContain("q4");
  });

  it("does not bring a deleted question back, and does not hand its id to a new one", () => {
    const after = addQuestion(deleteQuestion(freshKit(), "q6"), draft("New?"));
    expect(after.id).toBe("q7");
  });

  it("reorders without locking anything: order is presentation, not content", () => {
    const after = reorderQuestions(freshKit(), ["q6", "q5", "q4", "q3", "q2", "q1"]);
    expect(after.kit.questions.map((x) => x.id)).toEqual(["q6", "q5", "q4", "q3", "q2", "q1"]);
    expect(Object.values(after.meta.items).some(isLocked)).toBe(false);
  });

  it.each([
    [["q1", "q2"], "missing ids"],
    [["q1", "q1", "q2", "q3", "q4", "q5"], "a duplicate"],
    [["q1", "q2", "q3", "q4", "q5", "q9"], "an unknown id"],
  ])("refuses a new order with %s", (order) => {
    expect(() => reorderQuestions(freshKit(), order as string[])).toThrow("must list every question in the kit exactly once");
  });

  it.each([
    ["an unknown question", () => editQuestion(freshKit(), "q404", { prompt: "x" }), "ITEM_NOT_FOUND"],
    ["an unknown requirement", () => editQuestion(freshKit(), "q1", { requirement_ids: ["r404"] }), "INVALID_EDIT"],
    ["an unknown category", () => editQuestion(freshKit(), "q1", { category: "trivia" as Question["category"] }), "INVALID_EDIT"],
    ["a difficulty out of range", () => editQuestion(freshKit(), "q1", { difficulty: 9 }), "INVALID_EDIT"],
    ["an empty prompt", () => editQuestion(freshKit(), "q1", { prompt: "" }), "INVALID_EDIT"],
  ])("refuses %s, leaving the kit valid", (_name, attempt, code) => {
    expect(attempt).toThrowError(expect.objectContaining({ name: "KitEditError", code }));
  });
});

describe("editing flashcards", () => {
  it("edits, adds, deletes and reorders, with the same rules as questions", () => {
    let state = editFlashcard(freshKit(), "f1", { front: "My wording" });
    expect(isLocked(metaOf(state.meta, "f1"))).toBe(true);

    const added = addFlashcard(state, { front: "STAR", back: "Situation, task, action, result.", requirement_ids: ["r2"] });
    expect(added.id).toBe("f3");
    expect(metaOf(added.meta, "f3").origin).toBe("user");

    state = reorderFlashcards(added, ["f3", "f2", "f1"]);
    expect(state.kit.flashcards.map((f) => f.id)).toEqual(["f3", "f2", "f1"]);

    state = deleteFlashcard(state, "f2");
    expect(state.kit.flashcards.map((f) => f.id)).toEqual(["f3", "f1"]);
    expect(validateKit(state.kit)).toMatchObject({ ok: true });
  });

  it("pins a flashcard, and refuses to pin something that is not there", () => {
    expect(metaOf(setPinned(freshKit(), "f2", true).meta, "f2").pinned).toBe(true);
    expect(() => setPinned(freshKit(), "f404", true)).toThrow("There is no flashcard f404 in this kit");
  });
});

describe("setEdited", () => {
  it("after an undo an item counts as untouched again, so a regeneration may replace it", () => {
    const edited = editQuestion(freshKit(), "q1", { prompt: "Changed" });
    expect(metaOf(edited.meta, "q1").edited).toBe(true);
    const restored = setEdited(edited, "q1", false);
    expect(metaOf(restored.meta, "q1")).toEqual({ origin: "generated", edited: false, pinned: false });
  });

  it("works for a brief field, and refuses an item the kit does not have", () => {
    const state = setEdited(editBrief(freshKit(), "summary", "Mine"), "brief.summary", false);
    expect(metaOf(state.meta, "brief.summary").edited).toBe(false);
    expect(() => setEdited(freshKit(), "q99", false)).toThrow(KitEditError);
    expect(() => setEdited(freshKit(), "brief.sources", false)).toThrow(KitEditError);
  });
});

describe("revert: an undo in one operation", () => {
  it("puts the content back and leaves the item untouched, never edited in between", () => {
    const edited = editQuestion(freshKit(), "q1", { prompt: "Changed" });
    const original = freshKit().kit.questions.find((q) => q.id === "q1")!.prompt;
    const reverted = revertQuestion(edited, "q1", { prompt: original });
    expect(reverted.kit.questions.find((q) => q.id === "q1")!.prompt).toBe(original);
    expect(metaOf(reverted.meta, "q1")).toEqual({ origin: "generated", edited: false, pinned: false });
  });

  it("the same for a flashcard and a brief field", () => {
    const card = revertFlashcard(editFlashcard(freshKit(), "f1", { back: "Changed" }), "f1", { back: freshKit().kit.flashcards[0]!.back });
    expect(metaOf(card.meta, "f1").edited).toBe(false);
    const brief = revertBrief(editBrief(freshKit(), "summary", "Mine"), "summary", freshKit().kit.company_brief.summary);
    expect(brief.kit.company_brief.summary).toBe(freshKit().kit.company_brief.summary);
    expect(metaOf(brief.meta, "brief.summary").edited).toBe(false);
  });
});
