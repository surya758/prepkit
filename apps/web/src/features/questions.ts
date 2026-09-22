"use client";

import type { Question } from "@prepkit/core";
import { useCallback, useMemo } from "react";
import * as edits from "@/lib/kit-edits";
import type { QuestionDraft } from "@/lib/kit-edits";
import { useEditKit } from "./edit-kit";

// Every change a user can make to the kit's questions: which request it sends, how the
// page looks before the server answers, and what to say if it fails.

export function useQuestionEdits(kitId: string) {
  const { mutate, isPending } = useEditKit(kitId);

  const edit = useCallback(
    (id: string, patch: Partial<QuestionDraft>) =>
      mutate({
        method: "PATCH",
        path: `/questions/${id}`,
        body: patch,
        optimistic: (s) => edits.editQuestion(s, id, patch),
        failed: "Your change to this question was not saved",
      }),
    [mutate],
  );

  const add = useCallback(
    (category: Question["category"], draft: QuestionDraft) =>
      mutate({
        method: "POST",
        path: "/questions",
        body: { ...draft, category },
        optimistic: (s) => edits.addQuestion(s, category, draft),
        failed: "Your question could not be added",
      }),
    [mutate],
  );

  const remove = useCallback(
    (id: string, { onSettled }: { onSettled?: () => void } = {}) =>
      mutate(
        {
          method: "DELETE",
          path: `/questions/${id}`,
          optimistic: (s) => edits.deleteQuestion(s, id),
          failed: "This question could not be deleted",
        },
        { onSettled },
      ),
    [mutate],
  );

  const pin = useCallback(
    (id: string, pinned: boolean) =>
      mutate({
        method: "PUT",
        path: `/items/${id}/pin`,
        body: { pinned },
        optimistic: (s) => edits.setPinned(s, id, pinned),
        failed: pinned
          ? "This question could not be pinned"
          : "This question could not be unpinned",
      }),
    [mutate],
  );

  const reorder = useCallback(
    (orderedIds: string[]) =>
      mutate({
        method: "PUT",
        path: "/questions/order",
        // The server takes every question's id; the category's new order is folded into the whole.
        body: (s) => ({ ids: edits.fullOrder(s, orderedIds) }),
        optimistic: (s) => edits.reorderQuestions(s, orderedIds),
        failed: "The new order was not saved",
      }),
    [mutate],
  );

  const move = useCallback(
    (id: string, category: Question["category"]) =>
      mutate({
        method: "PATCH",
        path: `/questions/${id}`,
        body: { category },
        optimistic: (s) => edits.moveQuestion(s, id, category),
        failed: "This question could not be moved",
      }),
    [mutate],
  );

  return useMemo(
    () => ({ edit, add, remove, pin, reorder, move, isPending }),
    [edit, add, remove, pin, reorder, move, isPending],
  );
}

export type QuestionEdits = ReturnType<typeof useQuestionEdits>;
