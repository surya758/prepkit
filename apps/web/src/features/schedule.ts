"use client";

import { useCallback, useMemo } from "react";
import * as edits from "@/lib/kit-edits";
import type { DayPatch } from "@/lib/kit-edits";
import { useEditKit } from "./edit-kit";

/** Arranging a day by hand. Re-planning the whole schedule is a regeneration (features/regenerate). */
export function useScheduleEdits(kitId: string) {
  const { mutate, isPending } = useEditKit(kitId);

  const editDay = useCallback(
    (day: number, patch: DayPatch) =>
      mutate({ method: "PATCH", path: `/schedule/days/${day}`, body: patch, optimistic: (s) => edits.editScheduleDay(s, day, patch), failed: `Your change to day ${day} was not saved` }),
    [mutate],
  );

  return useMemo(() => ({ editDay, isPending }), [editDay, isPending]);
}
