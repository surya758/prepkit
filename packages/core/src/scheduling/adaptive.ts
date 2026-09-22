import type { PracticeProgress } from '../practice/practice';
import { CONFIDENT_FROM } from '../practice/practice';
import { MAX_EMPHASIS } from './schedule';
import type { Emphasis } from './schedule';

// Adaptive re-plan: practice confidence fed back into the scheduler. A plan made on day one
// goes stale by day two, because by then the user knows which requirements are giving them
// trouble. Rather than a second scheduler, the weak ones get more weight in the one that
// exists, so their questions rise in the ranking and land on earlier, fuller days. Everything
// else about the schedule — exactly N days, integer minutes, every question once — is unchanged,
// because the allocation is the same arithmetic.

/**
 * How weak each requirement looks from practice, 0 (every card easy) to 1 (every card
 * forgotten). Only rated cards count; a requirement with no rated cards has no entry, since
 * nothing is known about it yet and "unknown" is not "weak".
 */
export function requirementWeakness(progress: PracticeProgress): Map<string, number> {
  const confidenceOf = new Map(progress.cards.filter((c) => c.confidence !== null).map((c) => [c.card_id, c.confidence!]));
  const weakness = new Map<string, number>();
  for (const r of progress.requirements) {
    const rated = r.card_ids.map((id) => confidenceOf.get(id)).filter((c): c is 1 | 2 | 3 | 4 => c !== undefined);
    if (rated.length === 0) continue;
    // 4 (easy) -> 0, 1 (forgot) -> 1, on the same scale as CONFIDENT_FROM.
    const sum = rated.reduce((total, c) => total + (4 - c) / 3, 0);
    weakness.set(r.requirement_id, sum / rated.length);
  }
  return weakness;
}

/**
 * Weakness as emphasis: a requirement the user has forgotten everything about weighs double,
 * one they found easy weighs as it did. Between, in proportion. A requirement at or above
 * CONFIDENT_FROM on average gets no extra weight: known is known.
 */
export function emphasisFromPractice(progress: PracticeProgress): Emphasis {
  const confidentWeakness = (4 - CONFIDENT_FROM) / 3; // the weakness of a card rated exactly "good"
  const emphasis = new Map<string, number>();
  for (const [id, weakness] of requirementWeakness(progress)) {
    if (weakness <= confidentWeakness) continue;
    // Scale the range (confident, forgotten] onto (1, MAX_EMPHASIS].
    const above = (weakness - confidentWeakness) / (1 - confidentWeakness);
    emphasis.set(id, 1 + above * (MAX_EMPHASIS - 1));
  }
  return emphasis;
}

/** What a re-plan would change, in words the interface can show: which requirements move up. */
export function emphasisSummary(emphasis: Emphasis, requirementText: (id: string) => string): string[] {
  return [...emphasis.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, factor]) => `${requirementText(id)} (×${factor.toFixed(1)})`);
}
