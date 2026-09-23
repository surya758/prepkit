import type { Requirement } from "@prepkit/core";

// How a requirement is pointed at on screen: by its number in the role's list, 1-based, the
// same everywhere a question or flashcard refers to it. The kit's ids (r1, r2…) are for the
// kit; a person reads "3" and finds the third requirement on the Role tab.

export interface NumberedRequirement {
  number: number;
  text: string;
}

/** Requirement id → its number and text. An id the kit no longer has is left out. */
export function numberRequirements(requirements: Requirement[]): Map<string, NumberedRequirement> {
  return new Map(requirements.map((r, index) => [r.id, { number: index + 1, text: r.text }]));
}
