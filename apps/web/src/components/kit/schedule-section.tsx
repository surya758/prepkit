"use client";

import type { Kit, KitMeta } from "@prepkit/core";
import { CalendarClock, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRegenerate } from "@/features/regenerate";
import { useScheduleEdits } from "@/features/schedule";
import { DayEditor } from "./day-editor";
import { ReplanDialog } from "./replan-dialog";

export function ScheduleSection({ kitId, kit, meta }: { kitId: string; kit: Kit; meta: KitMeta | null }) {
  const edits = useScheduleEdits(kitId);
  const regen = useRegenerate(kitId);
  const [editing, setEditing] = useState<number | null>(null);
  const [replanning, setReplanning] = useState(false);
  const replan = { section: "schedule" } as const;
  const running = regen.isRunning(replan);
  const byId = new Map(kit.questions.map((q) => [q.id, q]));
  const total = kit.schedule.days.reduce((sum, d) => sum + d.minutes, 0);
  const arrangedByHand = meta?.scheduleEdited ?? false;

  return (
    <div className="flex flex-col gap-4">
      <ReplanDialog key={kit.schedule.days_available} open={replanning} onOpenChange={setReplanning} currentDays={kit.schedule.days_available} arrangedByHand={arrangedByHand} pending={running} onConfirm={(days) => regen.regenerate({ section: "schedule", days }, { onSuccess: () => setReplanning(false) })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">
          {kit.schedule.days_available} {kit.schedule.days_available === 1 ? "day" : "days"} <span className="font-sans text-sm text-muted-foreground">{Math.round(total / 60 * 10) / 10} hours in all</span>
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setReplanning(true)} disabled={running}>
          <CalendarClock aria-hidden="true" />
          Re-plan
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {arrangedByHand
          ? "Arranged by hand. Adding or removing questions patches these days; Re-plan starts again from the questions."
          : "Planned from the questions: must-have requirements and harder questions come first, and the last days review. Edit a day to arrange it yourself."}
      </p>

      <ol className="flex flex-col gap-3">
        {kit.schedule.days.map((day) => (
          <li key={day.day}>
            {editing === day.day ? (
              <DayEditor day={day} questions={kit.questions} saving={edits.isPending} onSave={(patch) => edits.editDay(day.day, patch)} onClose={() => setEditing(null)} />
            ) : (
              <article aria-label={`Day ${day.day}`} className="flex gap-3 rounded-xl border bg-card p-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-sm">{day.day}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{day.focus}</p>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{day.minutes} min</span>
                  </div>
                  {day.question_ids.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No questions: read the brief and the requirements.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {day.question_ids.map((id) => (
                        <li key={id} className="flex gap-2 text-sm">
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">{id}</span>
                          <span className="text-muted-foreground">{byId.get(id)?.prompt ?? "(a question that has been deleted)"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(day.day)} aria-label={`Edit day ${day.day}`}>
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
