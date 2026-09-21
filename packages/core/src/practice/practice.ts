import type { Flashcard, Kit } from "../schema/kit";

// Practice mode's rules, as pure functions. Storing the records is the API's job; what a
// rating means, what counts as covered and which card comes next are decided here.
//
// Why a confidence-weighted sort and not spaced-repetition intervals: the user is preparing
// for an interview a few days away. SM-2 would schedule a well-known card a week or more out,
// which is after the interview, so most of its intervals would never come due. Inside so short
// a window the useful question is "what am I worst at right now?", and a sort answers it.

/** 1 forgot · 2 shaky · 3 good · 4 easy */
export const CONFIDENCE_LEVELS = [1, 2, 3, 4] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** A card rated this or higher counts as known. Below it, the card is weak. */
export const CONFIDENT_FROM: Confidence = 3;

export interface PracticeRecord {
  cardId: string;
  /** The latest rating. Earlier ones are not kept: how the user feels now is what orders the next session. */
  confidence: Confidence;
  /** How many times the card has been rated. */
  reps: number;
  /** ISO 8601, UTC. */
  reviewedAt: string;
}

export function recordRating(previous: PracticeRecord | undefined, cardId: string, confidence: Confidence, at: Date): PracticeRecord {
  return { cardId, confidence, reps: (previous?.reps ?? 0) + 1, reviewedAt: at.toISOString() };
}

/**
 * Every card in the kit, in the order to practise them next:
 *
 *   1. cards never rated, in kit order — nothing is known about them yet
 *   2. then the lowest confidence first
 *   3. same confidence: the one reviewed longest ago first
 *   4. still tied: kit order
 *
 * A record for a card the kit no longer holds is ignored. Card ids are never reused, so such
 * a record can never be mistaken for another card's.
 */
export function nextSessionOrder(flashcards: Flashcard[], records: PracticeRecord[]): string[] {
  const byCard = new Map(records.map((r) => [r.cardId, r]));
  const position = new Map(flashcards.map((f, index) => [f.id, index]));

  return flashcards
    .map((f) => f.id)
    .sort((a, b) => {
      const ra = byCard.get(a);
      const rb = byCard.get(b);
      if (!ra || !rb) return ra ? 1 : rb ? -1 : position.get(a)! - position.get(b)!;
      if (ra.confidence !== rb.confidence) return ra.confidence - rb.confidence;
      if (ra.reviewedAt !== rb.reviewedAt) return ra.reviewedAt < rb.reviewedAt ? -1 : 1;
      return position.get(a)! - position.get(b)!;
    });
}

export type CardStatus = "unseen" | "weak" | "confident";

/**
 * - no_cards: no flashcard is linked to the requirement, so there is nothing to practise
 * - not_started: it has cards, none rated yet
 * - weak: at least one of its rated cards is below CONFIDENT_FROM
 * - in_progress: every rated card is known, but some are still unseen
 * - confident: every card rated, all of them known
 */
export type RequirementPracticeStatus = "no_cards" | "not_started" | "weak" | "in_progress" | "confident";

export interface PracticeProgress {
  total: number;
  practised: number;
  confident: number;
  /** In kit order. */
  cards: Array<{ card_id: string; status: CardStatus; confidence: Confidence | null; reps: number; reviewed_at: string | null }>;
  /** In requirement order. */
  requirements: Array<{ requirement_id: string; card_ids: string[]; practised: number; status: RequirementPracticeStatus }>;
}

export function practiceProgress(kit: Pick<Kit, "role" | "flashcards">, records: PracticeRecord[]): PracticeProgress {
  const byCard = new Map(records.map((r) => [r.cardId, r]));

  const cards = kit.flashcards.map((f) => {
    const record = byCard.get(f.id);
    const status: CardStatus = !record ? "unseen" : record.confidence >= CONFIDENT_FROM ? "confident" : "weak";
    return { card_id: f.id, status, confidence: record?.confidence ?? null, reps: record?.reps ?? 0, reviewed_at: record?.reviewedAt ?? null };
  });
  const statusOf = new Map(cards.map((c) => [c.card_id, c.status]));

  const requirements = kit.role.requirements.map((r) => {
    const cardIds = kit.flashcards.filter((f) => f.requirement_ids.includes(r.id)).map((f) => f.id);
    const statuses = cardIds.map((id) => statusOf.get(id)!);
    const practised = statuses.filter((s) => s !== "unseen").length;
    return { requirement_id: r.id, card_ids: cardIds, practised, status: requirementStatus(statuses, practised) };
  });

  return {
    total: cards.length,
    practised: cards.filter((c) => c.status !== "unseen").length,
    confident: cards.filter((c) => c.status === "confident").length,
    cards,
    requirements,
  };
}

function requirementStatus(statuses: CardStatus[], practised: number): RequirementPracticeStatus {
  if (statuses.length === 0) return "no_cards";
  if (practised === 0) return "not_started";
  if (statuses.includes("weak")) return "weak";
  return practised < statuses.length ? "in_progress" : "confident";
}
