import { describe, expect, it } from "vitest";
import { createContext, flashcardSchema, generateFlashcards } from "../src";
import type { FlashcardInput, Requirement } from "../src";
import { createFakeProvider } from "../src/testing";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
  { id: "r2", text: "You have mentored junior engineers", kind: "behavioural", priority: "must" },
];

const input: FlashcardInput = {
  requirements,
  roleTitle: "Senior Frontend Engineer",
  seniority: "senior",
  companyFacts: "Acme builds route planning software.\nIt plans two million deliveries a month.",
  hiringProcess: { found: true, source: null, stages: [{ name: "Take-home exercise", description: "About three hours" }] },
};

const ctx = () => createContext({ deadlineMs: 150_000, strict: true });
const card = (front: string, requirement_ids: string[], back = "A short, checkable answer.") => ({ front, back, requirement_ids });

describe("generateFlashcards", () => {
  it("returns cards with ids from a counter, each satisfying the kit schema", async () => {
    const model = createFakeProvider([{ flashcards: [card("useMemo vs useCallback", ["r1"]), card("What does Acme build?", [])] }]);
    const cards = await generateFlashcards(model, input, ctx());

    expect(cards).toEqual([
      { id: "f1", front: "useMemo vs useCallback", back: "A short, checkable answer.", requirement_ids: ["r1"] },
      { id: "f2", front: "What does Acme build?", back: "A short, checkable answer.", requirement_ids: [] },
    ]);
    for (const c of cards) expect(flashcardSchema.safeParse(c).success).toBe(true);
  });

  it("asks for two cards per requirement plus three about the company, as delimited data", async () => {
    const model = createFakeProvider([{ flashcards: [card("Keys in lists", ["r1"])] }]);
    await generateFlashcards(model, input, ctx());

    const { system, user } = model.calls[0]!;
    expect(user).toContain("Write 7 flashcard(s). About 3 of them should be about the company or its interview process.");
    expect(user).toContain("<requirements>\nr1 [must] 5+ years with React\nr2 [must] You have mentored junior engineers\n</requirements>");
    expect(user).toContain("<company>\nAcme builds route planning software.");
    expect(user).toContain("<interview_process>\n- Take-home exercise: About three hours\n</interview_process>");
    expect(system).toContain("Never add facts about the company from outside those tags");
  });

  it("ignores requirement ids that were not sent, and removes duplicate fronts", async () => {
    const model = createFakeProvider([
      { flashcards: [card("What is reconciliation?", ["r1", "r77"]), card("what is reconciliation", ["r1"]), card("STAR method", ["r2"])] },
    ]);
    const cards = await generateFlashcards(model, input, ctx());
    expect(cards.map((c) => [c.id, c.front, c.requirement_ids])).toEqual([
      ["f1", "What is reconciliation?", ["r1"]],
      ["f2", "STAR method", ["r2"]],
    ]);
  });

  it("drops cards tied to nothing when the company was not researched", async () => {
    const context = ctx();
    const model = createFakeProvider([{ flashcards: [card("Hooks rules", ["r1"]), card("Acme was founded in 1999", [])] }]);
    const cards = await generateFlashcards(model, { ...input, companyFacts: "" }, context);

    expect(cards.map((c) => c.front)).toEqual(["Hooks rules"]);
    expect(model.calls[0]!.user).not.toContain("<company>");
    expect(model.calls[0]!.user).toContain("Write 4 flashcard(s).");
    expect(context.researchLog[0]!.reason).toContain("1 flashcard(s) kept, 1 dropped");
  });

  it("keeps company cards from crowding out the ones that teach something", async () => {
    const companyHeavy = [
      ...Array.from({ length: 7 }, (_, i) => card(`Company fact number ${i}`, [])),
      card("When does a useEffect cleanup run?", ["r1"]),
      card("Four parts of a STAR answer", ["r2"]),
    ];
    const cards = await generateFlashcards(createFakeProvider([{ flashcards: companyHeavy }]), input, ctx());

    expect(cards.filter((c) => c.requirement_ids.length === 0)).toHaveLength(4);
    expect(cards.map((c) => c.front)).toEqual(expect.arrayContaining(["When does a useEffect cleanup run?", "Four parts of a STAR answer"]));
  });

  it("tells the model that a requirement card is about the subject, not about the posting", async () => {
    const model = createFakeProvider([{ flashcards: [card("Keys in lists", ["r1"])] }]);
    await generateFlashcards(model, input, ctx());
    expect(model.calls[0]!.system).toContain("never what the job posting says");
    expect(model.calls[0]!.system).toContain("Every listed requirement gets at least one card");
  });

  it("caps the number of cards", async () => {
    const many = Array.from({ length: 30 }, (_, i) => card(`Distinct concept number ${i}`, ["r1"]));
    const cards = await generateFlashcards(createFakeProvider([{ flashcards: many }]), input, ctx());
    expect(cards).toHaveLength(16);
    expect(cards.at(-1)!.id).toBe("f16");
  });

  it("never leaves a requirement without a card because of the cap: the cap grows, and first cards are kept before second ones", async () => {
    const twenty: Requirement[] = Array.from({ length: 20 }, (_, i) => ({ id: `r${i + 1}`, text: `Requirement ${i + 1}`, kind: "technical", priority: i < 10 ? "must" : "nice" }));
    // The model writes two cards for r1..r10 first, then one each for r11..r20: 30 cards.
    const reply = [
      ...twenty.slice(0, 10).flatMap((r) => [card(`${r.text} first`, [r.id]), card(`${r.text} second`, [r.id])]),
      ...twenty.slice(10).map((r) => card(`${r.text} first`, [r.id])),
    ];
    const model = createFakeProvider([{ flashcards: reply }]);
    const cards = await generateFlashcards(model, { ...input, requirements: twenty, companyFacts: "" }, ctx());

    expect(model.calls[0]!.user).toContain("Write 20 flashcard(s). At least one for each listed requirement; second cards go to the must-haves.");
    expect(model.calls[0]!.user).toContain("r20 [nice] Requirement 20");
    // Cap of max(16, 20) = 20: one card for every requirement, none for any second.
    expect(cards).toHaveLength(20);
    const coveredIds = new Set(cards.flatMap((c) => c.requirement_ids));
    for (const r of twenty) expect(coveredIds.has(r.id)).toBe(true);
    expect(cards.filter((c) => c.front.endsWith("second"))).toHaveLength(0);
    expect(cards.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `f${i + 1}`));
  });

  it("makes no model call when there is nothing to make cards from", async () => {
    const model = createFakeProvider([]);
    const context = ctx();
    const cards = await generateFlashcards(model, { ...input, requirements: [], companyFacts: "" }, context);

    expect(cards).toEqual([]);
    expect(model.calls).toHaveLength(0);
    expect(context.researchLog[0]).toMatchObject({ step: "flashcards", outcome: "skipped" });
  });

  it("still makes company cards for a description with no requirements", async () => {
    const model = createFakeProvider([{ flashcards: [card("What does Acme build?", [])] }]);
    const cards = await generateFlashcards(model, { ...input, requirements: [] }, ctx());
    expect(cards).toHaveLength(1);
    expect(model.calls[0]!.user).toContain("Write 3 flashcard(s).");
  });
});
