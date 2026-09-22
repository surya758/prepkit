// One sitting of practice, as a value. The API decides the order to practise in (unseen first,
// then least confident) and returns a fresh one after every rating; a sitting takes the order
// once, when it starts, and walks it — the cards must not reshuffle under the user's feet.

export interface Session {
  /** Card ids in the order this sitting shows them. */
  order: string[];
  /** Index into order. Equal to order.length when the sitting is finished. */
  at: number;
  revealed: boolean;
  /** Ratings given in this sitting, by card id. */
  rated: Record<string, 1 | 2 | 3 | 4>;
}

export const start = (order: string[]): Session => ({ order, at: 0, revealed: false, rated: {} });

export const currentCard = (s: Session): string | null => s.order[s.at] ?? null;
export const isFinished = (s: Session): boolean => s.at >= s.order.length;

export const reveal = (s: Session): Session => (isFinished(s) ? s : { ...s, revealed: true });

/** A rating is only possible once the answer has been seen; it moves on to the next card. */
export function rate(s: Session, confidence: 1 | 2 | 3 | 4): Session {
  const card = currentCard(s);
  if (!card || !s.revealed) return s;
  return { ...s, at: s.at + 1, revealed: false, rated: { ...s.rated, [card]: confidence } };
}

/** Skip is allowed before revealing: the card comes round again next sitting, still unseen. */
export const skip = (s: Session): Session => (isFinished(s) ? s : { ...s, at: s.at + 1, revealed: false });

/** A card deleted in the builder while a sitting is open simply drops out of it. */
export function withoutCards(s: Session, missing: Set<string>): Session {
  const kept = s.order.filter((id) => !missing.has(id));
  const removedBefore = s.order.slice(0, s.at).filter((id) => missing.has(id)).length;
  return { ...s, order: kept, at: Math.min(s.at - removedBefore, kept.length) };
}
