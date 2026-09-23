"use client";

import { useCallback, useMemo } from "react";
import * as edits from "@/lib/kit-edits";
import type { FlashcardDraft } from "@/lib/kit-edits";
import { useEditKit } from "./edit-kit";

/** Every change a user can make to the flashcards. The sibling of useQuestionEdits. */
export function useFlashcardEdits(kitId: string) {
  const { mutate, isPending } = useEditKit(kitId);

  const edit = useCallback(
    (id: string, patch: Partial<FlashcardDraft>) =>
      mutate({ method: "PATCH", path: `/flashcards/${id}`, body: patch, optimistic: (s) => edits.editFlashcard(s, id, patch), failed: "Your change to this flashcard was not saved" }),
    [mutate],
  );

  const add = useCallback(
    (draft: FlashcardDraft) => mutate({ method: "POST", path: "/flashcards", body: draft, optimistic: (s) => edits.addFlashcard(s, draft), failed: "Your flashcard could not be added" }),
    [mutate],
  );

  const remove = useCallback(
    (id: string, { onSettled }: { onSettled?: () => void } = {}) =>
      mutate({ method: "DELETE", path: `/flashcards/${id}`, optimistic: (s) => edits.deleteFlashcard(s, id), failed: "This flashcard could not be deleted" }, { onSettled }),
    [mutate],
  );

  // Undo changes, as for questions: save the original back, then clear the edited flag if the
  // card was untouched when the editor opened.
  const undo = useCallback(
    (id: string, patch: Partial<FlashcardDraft>, wasUntouched: boolean) =>
      mutate(
        { method: "PATCH", path: `/flashcards/${id}`, body: patch, optimistic: (s) => edits.editFlashcard(s, id, patch), failed: "Your changes to this flashcard could not be undone" },
        { onSuccess: () => { if (wasUntouched) mutate({ method: "PUT", path: `/items/${id}/edited`, body: { edited: false }, optimistic: (s) => edits.setEdited(s, id, false), failed: "This flashcard is still marked as edited" }); } },
      ),
    [mutate],
  );

  const pin = useCallback(
    (id: string, pinned: boolean) =>
      mutate({ method: "PUT", path: `/items/${id}/pin`, body: { pinned }, optimistic: (s) => edits.setPinned(s, id, pinned), failed: pinned ? "This flashcard could not be pinned" : "This flashcard could not be unpinned" }),
    [mutate],
  );

  const reorder = useCallback(
    (orderedIds: string[]) =>
      mutate({ method: "PUT", path: "/flashcards/order", body: { ids: orderedIds }, optimistic: (s) => edits.reorderFlashcards(s, orderedIds), failed: "The new order was not saved" }),
    [mutate],
  );

  return useMemo(() => ({ edit, undo, add, remove, pin, reorder, isPending }), [edit, undo, add, remove, pin, reorder, isPending]);
}
