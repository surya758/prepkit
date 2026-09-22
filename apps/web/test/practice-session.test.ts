import { describe, expect, it } from "vitest";
import { currentCard, isFinished, rate, reveal, skip, start, withoutCards } from "@/lib/practice-session";

describe("a practice sitting", () => {
  it("starts on the first card, answer hidden", () => {
    const s = start(["f3", "f1", "f2"]);
    expect(currentCard(s)).toBe("f3");
    expect(s.revealed).toBe(false);
    expect(isFinished(s)).toBe(false);
  });

  it("cannot be rated before the answer is revealed", () => {
    const s = start(["f1", "f2"]);
    expect(rate(s, 4)).toBe(s);
    expect(currentCard(rate(reveal(s), 4))).toBe("f2");
  });

  it("walks the order it was given, hiding each answer again", () => {
    let s = start(["f1", "f2"]);
    s = rate(reveal(s), 2);
    expect(s.revealed).toBe(false);
    s = rate(reveal(s), 4);
    expect(isFinished(s)).toBe(true);
    expect(currentCard(s)).toBeNull();
    expect(s.rated).toEqual({ f1: 2, f2: 4 });
  });

  it("can skip a card without rating it", () => {
    const s = skip(start(["f1", "f2"]));
    expect(currentCard(s)).toBe("f2");
    expect(s.rated).toEqual({});
  });

  it("does nothing once finished", () => {
    const done = rate(reveal(start(["f1"])), 3);
    expect(reveal(done)).toBe(done);
    expect(skip(done)).toBe(done);
    expect(rate(done, 1)).toBe(done);
  });

  it("is empty, and therefore finished, when the kit has no cards", () => {
    expect(isFinished(start([]))).toBe(true);
  });

  it("drops cards deleted meanwhile, keeping its place", () => {
    let s = start(["f1", "f2", "f3", "f4"]);
    s = rate(reveal(s), 3); // now at f2
    const after = withoutCards(s, new Set(["f1", "f3"]));
    expect(after.order).toEqual(["f2", "f4"]);
    expect(currentCard(after)).toBe("f2");
  });

  it("finishes if the current and all later cards were deleted", () => {
    const s = rate(reveal(start(["f1", "f2"])), 3);
    expect(isFinished(withoutCards(s, new Set(["f2"])))).toBe(true);
  });
});
