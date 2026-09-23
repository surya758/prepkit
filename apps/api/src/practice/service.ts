import { nextSessionOrder, practiceProgress } from "@prepkit/core";
import type { Confidence, PracticeProgress } from "@prepkit/core";
import { notFound } from "../errors";
import { findReadyKit } from "../kits/ready-kit";
import type { KitRepository } from "../kits/repository";
import type { PracticeRepository } from "./repository";

// Practice mode, as a service. What a rating means and which card comes next are rules in
// @prepkit/core; this file joins them to the stored kit and the stored ratings.

export interface PracticeView {
  /** What has been covered and what has not, per card and per requirement. */
  progress: PracticeProgress;
  /** Every card id, in the order to practise them next: unseen first, then least confident. */
  order: string[];
}

export interface PracticeServiceDependencies {
  kits: Pick<KitRepository, "findOwned">;
  practice: PracticeRepository;
  now?: () => Date;
}

export type PracticeService = ReturnType<typeof createPracticeService>;

export function createPracticeService({ kits, practice, now = () => new Date() }: PracticeServiceDependencies) {
  async function view(userId: string, kitId: string): Promise<PracticeView> {
    // Read after any write, and against the kit as it is now: a card deleted in the builder
    // drops out of both answers, whatever was recorded for it.
    const { kit } = await findReadyKit(kits, userId, kitId, "practised");
    const records = await practice.listForKit(userId, kitId);
    return { progress: practiceProgress(kit, records), order: nextSessionOrder(kit.flashcards, records) };
  }

  return {
    get: view,

    async rate(userId: string, kitId: string, cardId: string, confidence: Confidence): Promise<PracticeView> {
      const { kit } = await findReadyKit(kits, userId, kitId, "practised");
      if (!kit.flashcards.some((f) => f.id === cardId)) throw notFound("CARD_NOT_FOUND", "That flashcard is not in this kit");
      await practice.rate(userId, kitId, cardId, confidence, now());
      return view(userId, kitId);
    },

    async reset(userId: string, kitId: string): Promise<PracticeView> {
      await findReadyKit(kits, userId, kitId, "practised");
      await practice.deleteForKit(userId, kitId);
      return view(userId, kitId);
    },
  };
}
