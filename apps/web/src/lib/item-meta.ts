import type { ItemMeta, KitMeta } from "@prepkit/core";

// What the generated / edited / yours / pinned badges say, from the meta stored beside the kit.
// The rule is core's (isLocked): an item is kept through a regeneration if the user wrote it,
// changed it or pinned it. The badges make that rule visible before the user presses Regenerate.

export type Badge = "generated" | "edited" | "yours" | "pinned";

const GENERATED: ItemMeta = { origin: "generated", edited: false, pinned: false };

/** Stored meta may predate an item the user has just added; a missing entry means untouched. */
export const metaFor = (meta: KitMeta | null, id: string): ItemMeta => meta?.items[id] ?? GENERATED;

/**
 * Origin first — "yours" says more than "edited", since an item the user wrote is always the
 * user's whatever else happened to it — then pinned on top, since pinning is a separate choice.
 */
export function badgesFor(item: ItemMeta): Badge[] {
  const badges: Badge[] = [item.origin === "user" ? "yours" : item.edited ? "edited" : "generated"];
  if (item.pinned) badges.push("pinned");
  return badges;
}

/** True when a regeneration would keep this item exactly as it is. Mirrors core's isLocked. */
export const isKept = (item: ItemMeta): boolean => item.origin === "user" || item.edited || item.pinned;
