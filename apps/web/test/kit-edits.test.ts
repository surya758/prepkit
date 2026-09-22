import * as core from "@prepkit/core";
import type { Kit, KitMeta } from "@prepkit/core";
import { describe, expect, it } from "vitest";
import { addFlashcard, addQuestion, deleteFlashcard, deleteQuestion, editFlashcard, editQuestion, editScheduleDay, fullOrder, moveQuestion, reorderFlashcards, reorderQuestions, setPinned } from "@/lib/kit-edits";
import type { KitState } from "@/lib/kit-edits";

// A small valid kit, the shape the pipeline produces, with two questions in different categories.
const kit = (): Kit => ({
  source: { company: "Acme", company_url: "https://acme.example/", role: "Engineer", location: "", jd_chars: 100, researched_at: "2026-09-21T10:00:00.000Z", pages_used: [] },
  company_brief: { summary: "Acme.", what_they_do: "Things.", sources: [] },
  role: {
    title: "Engineer",
    seniority: "senior",
    responsibilities: [],
    requirements: [
      { id: "r1", text: "React", kind: "technical", priority: "must" },
      { id: "r2", text: "Mentoring", kind: "behavioural", priority: "nice" },
    ],
  },
  questions: [
    { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "State?", answer_outline: "Colocate.", difficulty: 2 },
    { id: "q2", requirement_ids: ["r2"], category: "behavioural", prompt: "Mentoring?", answer_outline: "STAR.", difficulty: 1 },
  ],
  flashcards: [
    { id: "f1", front: "useMemo?", back: "Caches a value.", requirement_ids: ["r1"] },
    { id: "f2", front: "STAR?", back: "Situation, task, action, result.", requirement_ids: ["r2"] },
  ],
  schedule: { days_available: 1, days: [{ day: 1, focus: "All", question_ids: ["q1", "q2"], minutes: 25 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});

const state = (): KitState => ({ kit: kit(), meta: core.initialMeta(kit()) });
const draft = { prompt: "A new one?", answer_outline: "Outline.", difficulty: 3, requirement_ids: ["r1"] };

/** What the server will answer with, minus what it alone computes. */
const comparable = ({ kit, meta }: KitState) => ({ questions: kit.questions, items: meta.items, nextQuestion: meta.nextQuestion });

describe("the browser's optimistic rules agree with core's real ones", () => {
  it("editing", () => {
    expect(comparable(editQuestion(state(), "q1", { prompt: "Changed?" }))).toEqual(comparable(core.editQuestion(state(), "q1", { prompt: "Changed?" })));
  });

  it("adding: same id, same origin, same counter", () => {
    const ours = addQuestion(state(), "technical", draft);
    const theirs = core.addQuestion(state(), { category: "technical", ...draft });
    expect(ours.id).toBe(theirs.id);
    expect(comparable(ours)).toEqual(comparable(theirs));
  });

  it("deleting", () => {
    expect(comparable(deleteQuestion(state(), "q1"))).toEqual(comparable(core.deleteQuestion(state(), "q1")));
  });

  it("pinning and unpinning", () => {
    expect(comparable(setPinned(state(), "q2", true))).toEqual(comparable(core.setPinned(state(), "q2", true)));
    const pinned = setPinned(state(), "q2", true);
    expect(comparable(setPinned(pinned, "q2", false))).toEqual(comparable(core.setPinned(pinned, "q2", false)));
  });

  it("reordering: the browser reorders one category, and sends the server the whole list it computed", () => {
    const three = addQuestion(state(), "technical", draft); // q1 tech, q2 behavioural, q3 tech
    const ours = reorderQuestions(three, ["q3", "q1"]);
    const sent = fullOrder(three, ["q3", "q1"]);
    expect(sent).toEqual(["q3", "q2", "q1"]);
    expect(comparable(ours)).toEqual(comparable(core.reorderQuestions(three, sent)));
  });

  it("reordering one category leaves the others where they are", () => {
    const three = addQuestion(state(), "technical", draft); // q1 tech, q2 behavioural, q3 tech
    // Only the technical ids are given, in their new order: q2 must stay in the middle.
    expect(reorderQuestions(three, ["q3", "q1"]).kit.questions.map((q) => q.id)).toEqual(["q3", "q2", "q1"]);
  });

  it("moving to another category is an edit and nothing more: same place in the list, same meta", () => {
    const ours = moveQuestion(state(), "q1", "behavioural");
    const theirs = core.editQuestion(state(), "q1", { category: "behavioural" });
    expect(comparable(ours)).toEqual(comparable(theirs));
    expect(ours.kit.questions.map((q) => `${q.id}:${q.category}`)).toEqual(["q1:behavioural", "q2:behavioural"]);
  });

  it("a sequence: add, edit the new one, delete the old one, add again", () => {
    let ours: KitState = state();
    let theirs: KitState = state();
    const added = addQuestion(ours, "technical", draft);
    ours = editQuestion(deleteQuestion(added, "q1"), added.id, { difficulty: 1 });
    ours = addQuestion(ours, "behavioural", draft);
    theirs = core.addQuestion(theirs, { category: "technical", ...draft });
    theirs = core.editQuestion(core.deleteQuestion(theirs, "q1"), "q3", { difficulty: 1 });
    theirs = core.addQuestion(theirs, { category: "behavioural", ...draft });
    expect(comparable(ours)).toEqual(comparable(theirs));
    expect(ours.kit.questions.map((q) => q.id)).toEqual(["q2", "q3", "q4"]); // q1's number is not reused
  });
});

describe("the browser's rules on their own", () => {
  it("never change the state they were given", () => {
    const before = state();
    const frozen = JSON.stringify(before);
    editQuestion(before, "q1", { prompt: "x" });
    addQuestion(before, "technical", draft);
    deleteQuestion(before, "q1");
    setPinned(before, "q1", true);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("marks an edited question as edited, and keeps its other flags", () => {
    const pinned = setPinned(state(), "q1", true);
    expect(editQuestion(pinned, "q1", { prompt: "x" }).meta.items.q1).toEqual({ origin: "generated", edited: true, pinned: true });
  });

  it("a new question is the user's, unedited and unpinned, at the end of the list", () => {
    const next = addQuestion(state(), "behavioural", draft);
    expect(next.kit.questions.at(-1)).toEqual({ id: "q3", category: "behavioural", ...draft });
    expect(next.meta.items.q3).toEqual({ origin: "user", edited: false, pinned: false });
  });

  it("deleting a question also forgets its meta", () => {
    const pinned = setPinned(state(), "q1", true);
    expect(deleteQuestion(pinned, "q1").meta.items).not.toHaveProperty("q1");
  });

  it("copes with meta that has no entry for the item", () => {
    const meta: KitMeta = { items: {}, nextQuestion: 3, nextFlashcard: 1, scheduleEdited: false };
    expect(setPinned({ kit: kit(), meta }, "q1", true).meta.items.q1).toEqual({ origin: "generated", edited: false, pinned: true });
  });
});

describe("the flashcard rules agree with core's", () => {
  const card = { front: "New?", back: "Yes.", requirement_ids: ["r2"] };
  const cards = ({ kit, meta }: KitState) => ({ flashcards: kit.flashcards, items: meta.items, nextFlashcard: meta.nextFlashcard });

  it("editing", () => {
    expect(cards(editFlashcard(state(), "f1", { back: "Changed." }))).toEqual(cards(core.editFlashcard(state(), "f1", { back: "Changed." })));
  });

  it("adding: same id, the user's, counter advanced", () => {
    const ours = addFlashcard(state(), card);
    const theirs = core.addFlashcard(state(), card);
    expect(ours.id).toBe(theirs.id);
    expect(cards(ours)).toEqual(cards(theirs));
  });

  it("deleting, and the number is not reused by the next add", () => {
    const ours = addFlashcard(deleteFlashcard(state(), "f1"), card);
    const theirs = core.addFlashcard(core.deleteFlashcard(state(), "f1"), card);
    expect(cards(ours)).toEqual(cards(theirs));
    expect(ours.kit.flashcards.map((f) => f.id)).toEqual(["f2", "f3"]);
  });

  it("reordering", () => {
    expect(cards(reorderFlashcards(state(), ["f2", "f1"]))).toEqual(cards(core.reorderFlashcards(state(), ["f2", "f1"])));
  });

  it("pinning a flashcard", () => {
    expect(cards(setPinned(state(), "f2", true))).toEqual(cards(core.setPinned(state(), "f2", true)));
  });
});

describe("the schedule rule agrees with core's", () => {
  it("editing a day changes that day and marks the schedule as arranged by hand", () => {
    const patch = { focus: "React only", minutes: 40, question_ids: ["q1"] };
    const ours = editScheduleDay(state(), 1, patch);
    const theirs = core.editScheduleDay(state(), 1, patch);
    expect(ours.kit.schedule).toEqual(theirs.kit.schedule);
    expect(ours.meta.scheduleEdited).toBe(true);
    expect(theirs.meta.scheduleEdited).toBe(true);
  });
});
