"use client";

import { useCallback, useMemo } from "react";
import * as edits from "@/lib/kit-edits";
import type { BriefField } from "@/lib/kit-edits";
import { useEditKit } from "./edit-kit";

// The one change a user can make to the company brief: rewriting a field. Regenerating it is
// features/regenerate.ts, since nothing about that is predicted in the browser.

export function useBriefEdits(kitId: string) {
  const { mutate, isPending } = useEditKit(kitId);

  const edit = useCallback(
    (field: BriefField, value: string) =>
      mutate({
        method: "PATCH",
        path: "/brief",
        body: { field, value },
        optimistic: (s) => edits.editBrief(s, field, value),
        failed: "Your change to the brief was not saved",
      }),
    [mutate],
  );

  // Undo changes: the original text is saved back, then the field counts as untouched again if
  // it was untouched when the editor opened.
  const undo = useCallback(
    (field: BriefField, value: string, wasUntouched: boolean) =>
      mutate(
        { method: "PATCH", path: "/brief", body: { field, value }, optimistic: (s) => edits.editBrief(s, field, value), failed: "Your changes to the brief could not be undone" },
        { onSuccess: () => { if (wasUntouched) mutate({ method: "PUT", path: `/items/brief.${field}/edited`, body: { edited: false }, optimistic: (s) => edits.setEdited(s, `brief.${field}`, false), failed: "This field is still marked as edited" }); } },
      ),
    [mutate],
  );

  return useMemo(() => ({ edit, undo, isPending }), [edit, undo, isPending]);
}
