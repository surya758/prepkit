import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONFIDENCE_LEVELS, nextSessionOrder, practiceProgress } from "../src";
import type { Confidence, Flashcard, Kit, PracticeRecord } from "../src";
import { makeKit } from "./fixtures/kit";

const card = (id: string, requirement_ids: string[] = []): Flashcard => ({ id, front: `front ${id}`, back: `back ${id}`, requirement_ids });
const rated = (cardId: string, confidence: Confidence, day: number, reps = 1): PracticeRecord => ({
  cardId,
  confidence,
  reps,
  reviewedAt: new Date(Date.UTC(2026, 8, day)).toISOString(),
});

describe("nextSessionOrder", () => {
  const deck = [card("f1"), card("f2"), card("f3"), card("f4"), card("f5")];

  it("is the kit's own order before anything has been practised", () => {
    expect(nextSessionOrder(deck, [])).toEqual(["f1", "f2", "f3", "f4", "f5"]);
  });

  it("puts cards never rated first, then the least confident", () => {
    const records = [rated("f1", 4, 20), rated("f2", 1, 20), rated("f4", 3, 20)];
    expect(nextSessionOrder(deck, records)).toEqual(["f3", "f5", "f2", "f4", "f1"]);
  });

  it("breaks a tie in confidence by the card reviewed longest ago", () => {
    const records = deck.map((c, i) => rated(c.id, 2, 20 - i)); // f5 was reviewed first, f1 last
    expect(nextSessionOrder(deck, records)).toEqual(["f5", "f4", "f3", "f2", "f1"]);
  });

  it("falls back to kit order when confidence and review time are both equal", () => {
    const records = [rated("f3", 2, 20), rated("f1", 2, 20)];
    expect(nextSessionOrder([card("f1"), card("f3")], records)).toEqual(["f1", "f3"]);
  });

  it("ignores a record for a card the kit no longer holds", () => {
    expect(nextSessionOrder([card("f1"), card("f2")], [rated("f9", 1, 20), rated("f1", 3, 20)])).toEqual(["f2", "f1"]);
  });

  it("does not change the deck it was given", () => {
    const before = deck.map((c) => c.id);
    nextSessionOrder(deck, [rated("f5", 1, 20)]);
    expect(deck.map((c) => c.id)).toEqual(before);
  });

  it("always returns every card once, unseen before seen, and seen in rising confidence", () => {
    const scenario = fc.record({
      size: fc.integer({ min: 0, max: 20 }),
      ratings: fc.array(fc.record({ index: fc.nat({ max: 24 }), confidence: fc.constantFrom(...CONFIDENCE_LEVELS), day: fc.integer({ min: 1, max: 28 }) }), {
        maxLength: 30,
      }),
    });

    fc.assert(
      fc.property(scenario, ({ size, ratings }) => {
        const cards = Array.from({ length: size }, (_, i) => card(`f${i + 1}`));
        // Later ratings of the same card replace earlier ones, as the store would. Indexes past the deck are stale records.
        const latest = new Map(ratings.map((r) => [`f${r.index + 1}`, rated(`f${r.index + 1}`, r.confidence, r.day)]));
        const order = nextSessionOrder(cards, [...latest.values()]);

        expect([...order].sort()).toEqual(cards.map((c) => c.id).sort());
        const confidences = order.map((id) => latest.get(id)?.confidence ?? 0); // 0 stands for unseen
        expect(confidences).toEqual([...confidences].sort((a, b) => a - b));
      }),
    );
  });
});

describe("practiceProgress", () => {
  /** r1 has three cards, r2 one, r3 none. f5 belongs to no requirement: a company card. */
  const kit = (): Kit => ({
    ...makeKit(),
    flashcards: [card("f1", ["r1"]), card("f2", ["r1"]), card("f3", ["r1", "r2"]), card("f5")],
  });
  const statusOf = (records: PracticeRecord[]) => Object.fromEntries(practiceProgress(kit(), records).requirements.map((r) => [r.requirement_id, r.status]));

  it("reports every card unseen, and says which requirements have nothing to practise", () => {
    const progress = practiceProgress(kit(), []);
    expect(progress).toMatchObject({ total: 4, practised: 0, confident: 0 });
    expect(progress.cards[0]).toEqual({ card_id: "f1", status: "unseen", confidence: null, reps: 0, reviewed_at: null });
    expect(progress.requirements).toEqual([
      { requirement_id: "r1", card_ids: ["f1", "f2", "f3"], practised: 0, status: "not_started" },
      { requirement_id: "r2", card_ids: ["f3"], practised: 0, status: "not_started" },
      { requirement_id: "r3", card_ids: [], practised: 0, status: "no_cards" },
    ]);
  });

  it("counts a card rated 3 or 4 as known and one rated 1 or 2 as weak", () => {
    const progress = practiceProgress(kit(), [rated("f1", 3, 20), rated("f2", 2, 20), rated("f5", 4, 20, 2)]);
    expect(progress).toMatchObject({ total: 4, practised: 3, confident: 2 });
    expect(progress.cards.map((c) => c.status)).toEqual(["confident", "weak", "unseen", "confident"]);
    expect(progress.cards[3]).toMatchObject({ confidence: 4, reps: 2, reviewed_at: "2026-09-20T00:00:00.000Z" });
  });

  it("calls a requirement weak as soon as one of its cards is, whatever else is unseen", () => {
    expect(statusOf([rated("f1", 4, 20), rated("f2", 1, 20)]).r1).toBe("weak");
  });

  it("calls it in progress while its rated cards are known and some are still unseen", () => {
    expect(statusOf([rated("f1", 4, 20)])).toEqual({ r1: "in_progress", r2: "not_started", r3: "no_cards" });
  });

  it("calls it confident only when every one of its cards is known", () => {
    expect(statusOf([rated("f1", 3, 20), rated("f2", 4, 20), rated("f3", 3, 20)])).toEqual({ r1: "confident", r2: "confident", r3: "no_cards" });
  });

  it("ignores a record for a card the kit no longer holds", () => {
    expect(practiceProgress(kit(), [rated("f9", 4, 20)])).toMatchObject({ practised: 0, confident: 0 });
  });
});
