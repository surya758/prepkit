"use client";

import type { Kit, KitMeta } from "@prepkit/core";
import { CalendarClock, Pencil } from "lucide-react";
import { useState } from "react";
import { focusAfterRender } from "@/components/focus-after-render";
import { Button } from "@/components/ui/button";
import { usePracticeView } from "@/features/practice";
import { useRegenerate } from "@/features/regenerate";
import { useScheduleEdits } from "@/features/schedule";
import { DayEditor } from "./day-editor";
import { ReplanDialog } from "./replan-dialog";

export function ScheduleSection({
  kitId,
  kit,
  meta,
}: {
  kitId: string;
  kit: Kit;
  meta: KitMeta | null;
}) {
  const edits = useScheduleEdits(kitId);
  const regen = useRegenerate(kitId);
  const [editing, setEditing] = useState<number | null>(null);
  const [replanning, setReplanning] = useState(false);
  // What the last adaptive re-plan moved earlier, shown until the next change to the schedule.
  const [emphasised, setEmphasised] = useState<string[] | null>(null);
  const practice = usePracticeView(kitId);
  const replan = { section: "schedule" } as const;
  const running = regen.isRunning(replan);
  const byId = new Map(kit.questions.map((q) => [q.id, q]));
  const total = kit.schedule.days.reduce((sum, d) => sum + d.minutes, 0);
  const arrangedByHand = meta?.scheduleEdited ?? false;

  return (
    <div className="flex flex-col gap-4">
      <ReplanDialog
        key={`${kit.schedule.days_available}-${practice.data?.progress.practised ?? 0}`}
        open={replanning}
        // The dialog is opened by state, not by a Radix trigger, so focus is put back by hand.
        onOpenChange={(open) => {
          setReplanning(open);
          if (!open) focusAfterRender("#replan");
        }}
        currentDays={kit.schedule.days_available}
        arrangedByHand={arrangedByHand}
        pending={running}
        practised={practice.data?.progress.practised ?? 0}
        onConfirm={(days, adaptive) =>
          regen.regenerate(
            { section: "schedule", days, adaptive },
            {
              onSuccess: (response) => {
                setReplanning(false);
                setEmphasised(adaptive ? (response.emphasised ?? []) : null);
                focusAfterRender("#replan");
              },
            },
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">
          {kit.schedule.days_available}{" "}
          {kit.schedule.days_available === 1 ? "day" : "days"}{" "}
          <span className="font-sans text-sm text-muted-foreground">
            {Math.round((total / 60) * 10) / 10} hours in all
          </span>
        </h2>
        <Button
          id="replan"
          variant="secondary"
          size="sm"
          onClick={() => setReplanning(true)}
          // Whether the dialog offers the adaptive option depends on the practice data, so the
          // button waits for it: opened a moment after a fresh load, the option would be missing.
          disabled={running || practice.isPending}
        >
          <CalendarClock aria-hidden="true" />
          Re-plan
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {arrangedByHand
          ? "Arranged by hand. Adding or removing questions patches these days; Re-plan starts again from the questions."
          : "Planned from the questions: must-have requirements and harder questions come first, and the last days review. Edit a day to arrange it yourself."}
      </p>

      {emphasised && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-xl border bg-accent/40 p-4 text-sm"
        >
          {emphasised.length === 0 ? (
            <p>
              Re-planned. Nothing you have practised so far counts as weak, so
              this is the plain plan.
            </p>
          ) : (
            <>
              <p className="font-medium">
                Re-planned around what you found hard. Moved earlier:
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {emphasised.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {kit.schedule.days.map((day) => (
          <li key={day.day}>
            {editing === day.day ? (
              <DayEditor
                day={day}
                questions={kit.questions}
                saving={edits.isPending}
                onSave={(patch) => edits.editDay(day.day, patch)}
                onClose={() => {
                  setEditing(null);
                  focusAfterRender(`[aria-label="Edit day ${day.day}"]`);
                }}
              />
            ) : (
              <article
                aria-label={`Day ${day.day}`}
                className="flex gap-3 rounded-xl border bg-card p-4"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-sm">
                  {day.day}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{day.focus}</p>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {day.minutes} min
                    </span>
                  </div>
                  {day.question_ids.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No questions: read the brief and the requirements.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {day.question_ids.map((id) => (
                        <li key={id} className="flex gap-2 text-sm">
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {id}
                          </span>
                          <span className="text-muted-foreground">
                            {byId.get(id)?.prompt ??
                              "(a question that has been deleted)"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(day.day)}
                      aria-label={`Edit day ${day.day}`}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                  </div>
                </div>
              </article>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
