import type { ItemMeta, KitMeta } from "@prepkit/core";
import { describe, expect, it } from "vitest";
import { badgesFor, isKept, metaFor } from "@/lib/item-meta";

const item = (partial: Partial<ItemMeta>): ItemMeta => ({ origin: "generated", edited: false, pinned: false, ...partial });

describe("badgesFor", () => {
  it.each<[Partial<ItemMeta>, string[]]>([
    [{}, ["generated"]],
    [{ edited: true }, ["edited"]],
    [{ origin: "user" }, ["yours"]],
    [{ origin: "user", edited: true }, ["yours"]],
    [{ pinned: true }, ["generated", "pinned"]],
    [{ edited: true, pinned: true }, ["edited", "pinned"]],
    [{ origin: "user", pinned: true }, ["yours", "pinned"]],
  ])("%j -> %j", (partial, badges) => {
    expect(badgesFor(item(partial))).toEqual(badges);
  });
});

describe("isKept", () => {
  it("is exactly core's lock rule: written, changed or pinned by the user", () => {
    expect(isKept(item({}))).toBe(false);
    expect(isKept(item({ edited: true }))).toBe(true);
    expect(isKept(item({ pinned: true }))).toBe(true);
    expect(isKept(item({ origin: "user" }))).toBe(true);
  });
});

describe("metaFor", () => {
  const meta: KitMeta = { items: { q1: item({ edited: true }) }, nextQuestion: 2, nextFlashcard: 1, scheduleEdited: false };

  it("reads the stored entry", () => {
    expect(metaFor(meta, "q1")).toEqual(item({ edited: true }));
  });

  it("treats an item with no entry, and a kit with no meta, as untouched", () => {
    expect(metaFor(meta, "q9")).toEqual(item({}));
    expect(metaFor(null, "q1")).toEqual(item({}));
  });
});
