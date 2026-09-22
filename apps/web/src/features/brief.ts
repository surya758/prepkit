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

  return useMemo(() => ({ edit, isPending }), [edit, isPending]);
}
