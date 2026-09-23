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

  // Undo changes: one request, untouched again if the field was so when the editor opened.
  const undo = useCallback(
    (field: BriefField, value: string, wasUntouched: boolean) =>
      wasUntouched
        ? mutate({ method: "POST", path: "/brief/revert", body: { field, value }, optimistic: (s) => edits.setEdited(edits.editBrief(s, field, value), `brief.${field}`, false), failed: "Your changes to the brief could not be undone" })
        : mutate({ method: "PATCH", path: "/brief", body: { field, value }, optimistic: (s) => edits.editBrief(s, field, value), failed: "Your changes to the brief could not be undone" }),
    [mutate],
  );

  return useMemo(() => ({ edit, undo, isPending }), [edit, undo, isPending]);
}
