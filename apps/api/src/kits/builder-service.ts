import {
  addFlashcard,
  addQuestion,
  deleteFlashcard,
  deleteQuestion,
  editBrief,
  editFlashcard,
  editQuestion,
  editScheduleDay,
  initialMeta,
  isLocked,
  mergeRegeneratedBrief,
  mergeRegeneratedCategory,
  metaOf,
  regenerateSchedule,
  reorderFlashcards,
  reorderQuestions,
  revertBrief,
  revertFlashcard,
  revertQuestion,
  setPinned,
} from "@prepkit/core";
import { emphasisFromPractice, emphasisSummary, practiceProgress } from "@prepkit/core";
import type { BriefField, DraftFlashcard, DraftQuestion, EditableKit, Kit, Question, ScheduleDay } from "@prepkit/core";
import type { PracticeRepository } from "../practice/repository";
import { AppError } from "../errors";
import { findReadyKit } from "./ready-kit";
import type { KitRecord, KitRepository } from "./repository";

// The builder, as a service. The rules are the pure functions in @prepkit/core; this file is
// only about applying one to a stored kit safely:
//
//   load the kit -> apply the rule -> save, but only if nobody saved in between -> else again
//
// That last condition is what makes simultaneous changes safe. Two edits landing together, or
// an edit landing while a regeneration is being merged, are each applied to the latest kit
// in turn; neither can overwrite the other.

const MAX_SAVE_ATTEMPTS = 5;

/** What the model is asked for during a regeneration. server.ts binds these to the real pipeline. */
export interface Regenerators {
  categoryDrafts(kit: Kit, category: Question["category"], lockedCount: number): Promise<DraftQuestion[]>;
  brief(kit: Kit): Promise<Kit["company_brief"]>;
}

export interface BuilderServiceDependencies {
  kits: KitRepository;
  regenerate: Regenerators;
  /** Read, never written, for an adaptive re-plan. */
  practice: Pick<PracticeRepository, "listForKit">;
  now?: () => Date;
}

/** A re-planned kit, and — when practice was consulted — which requirements were moved earlier. */
export type ReplannedKit = KitRecord & { emphasised: string[] };

type Change = (state: EditableKit) => EditableKit;

export type BuilderService = ReturnType<typeof createBuilderService>;

export function createBuilderService({ kits, regenerate, practice, now = () => new Date() }: BuilderServiceDependencies) {
  const loadReady = (userId: string, kitId: string) => findReadyKit(kits, userId, kitId, "edited");

  async function apply(userId: string, kitId: string, change: Change): Promise<KitRecord> {
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
      const record = await loadReady(userId, kitId);
      const next = change({ kit: record.kit, meta: record.meta ?? initialMeta(record.kit) });
      const at = now();
      if (await kits.saveEdited(kitId, userId, record.rev, next.kit, next.meta, at)) {
        return { ...record, kit: next.kit, meta: next.meta, rev: record.rev + 1, updatedAt: at };
      }
      // Someone saved first. Go round again, so the change is applied on top of theirs.
    }
    throw new AppError(409, "EDIT_CONFLICT", "This kit is being changed from somewhere else. Please try again.");
  }

  return {
    editQuestion: (userId: string, kitId: string, id: string, patch: Partial<DraftQuestion>) => apply(userId, kitId, (s) => editQuestion(s, id, patch)),
    addQuestion: (userId: string, kitId: string, draft: DraftQuestion) => apply(userId, kitId, (s) => addQuestion(s, draft)),
    deleteQuestion: (userId: string, kitId: string, id: string) => apply(userId, kitId, (s) => deleteQuestion(s, id)),
    reorderQuestions: (userId: string, kitId: string, ids: string[]) => apply(userId, kitId, (s) => reorderQuestions(s, ids)),

    editFlashcard: (userId: string, kitId: string, id: string, patch: Partial<DraftFlashcard>) => apply(userId, kitId, (s) => editFlashcard(s, id, patch)),
    addFlashcard: (userId: string, kitId: string, draft: DraftFlashcard) => apply(userId, kitId, (s) => addFlashcard(s, draft)),
    deleteFlashcard: (userId: string, kitId: string, id: string) => apply(userId, kitId, (s) => deleteFlashcard(s, id)),
    reorderFlashcards: (userId: string, kitId: string, ids: string[]) => apply(userId, kitId, (s) => reorderFlashcards(s, ids)),

    setPinned: (userId: string, kitId: string, id: string, pinned: boolean) => apply(userId, kitId, (s) => setPinned(s, id, pinned)),
    // Undo: the original content back and the item untouched again, as one change.
    revertQuestion: (userId: string, kitId: string, id: string, patch: Partial<DraftQuestion>) => apply(userId, kitId, (s) => revertQuestion(s, id, patch)),
    revertFlashcard: (userId: string, kitId: string, id: string, patch: Partial<DraftFlashcard>) => apply(userId, kitId, (s) => revertFlashcard(s, id, patch)),
    revertBrief: (userId: string, kitId: string, field: BriefField, value: string) => apply(userId, kitId, (s) => revertBrief(s, field, value)),
    editBrief: (userId: string, kitId: string, field: BriefField, value: string) => apply(userId, kitId, (s) => editBrief(s, field, value)),
    editScheduleDay: (userId: string, kitId: string, day: number, patch: Partial<Pick<ScheduleDay, "focus" | "minutes" | "question_ids">>) =>
      apply(userId, kitId, (s) => editScheduleDay(s, day, patch)),

    /**
     * The model is asked using the kit as it is now; that takes seconds, during which the user
     * may keep editing. The merge is therefore done inside apply(), on whatever the kit has
     * become by then, so anything edited in the meantime is locked and kept.
     */
    async regenerateCategory(userId: string, kitId: string, category: Question["category"]): Promise<KitRecord> {
      const before = await loadReady(userId, kitId);
      const meta = before.meta ?? initialMeta(before.kit);
      const lockedCount = before.kit.questions.filter((q) => q.category === category && isLocked(metaOf(meta, q.id))).length;
      const drafts = await regenerate.categoryDrafts(before.kit, category, lockedCount);
      return apply(userId, kitId, (s) => mergeRegeneratedCategory(s, category, drafts));
    },

    async regenerateBrief(userId: string, kitId: string): Promise<KitRecord> {
      const before = await loadReady(userId, kitId);
      const fresh = await regenerate.brief(before.kit);
      return apply(userId, kitId, (s) => mergeRegeneratedBrief(s, fresh));
    },

    /**
     * No model involved: allocation is arithmetic. `days` re-plans for a different interview
     * date. `adaptive` reads the user's practice ratings first and leans the plan toward the
     * requirements they found hardest; with nothing rated yet it is the plain plan, and the
     * answer says so by naming nothing.
     */
    async regenerateSchedule(userId: string, kitId: string, days?: number, adaptive = false): Promise<ReplannedKit> {
      if (!adaptive) return { ...(await apply(userId, kitId, (s) => regenerateSchedule(s, days))), emphasised: [] };
      const before = await loadReady(userId, kitId);
      const progress = practiceProgress(before.kit, await practice.listForKit(userId, kitId));
      const emphasis = emphasisFromPractice(progress);
      const text = new Map(before.kit.role.requirements.map((r) => [r.id, r.text]));
      const record = await apply(userId, kitId, (s) => regenerateSchedule(s, days, emphasis));
      return { ...record, emphasised: emphasisSummary(emphasis, (id) => text.get(id) ?? id) };
    },
  };
}
