"use client";

import type { Question, ScheduleDay } from "@prepkit/core";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DayPatch } from "@/lib/kit-edits";

const AUTOSAVE_MS = 500;
type Draft = Required<DayPatch>;
const draftOf = (d: ScheduleDay): Draft => ({ focus: d.focus, minutes: d.minutes, question_ids: d.question_ids });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

function patchOf(saved: Draft, draft: Draft): DayPatch {
  const patch: DayPatch = {};
  if (draft.focus !== saved.focus) patch.focus = draft.focus;
  if (draft.minutes !== saved.minutes) patch.minutes = draft.minutes;
  if (draft.question_ids.join() !== saved.question_ids.join()) patch.question_ids = draft.question_ids;
  return patch;
}

interface Props {
  day: ScheduleDay;
  questions: Question[];
  saving: boolean;
  onSave: (patch: DayPatch) => void;
  onClose: () => void;
}

export function DayEditor({ day, questions, saving, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(day));
  const [saved, setSaved] = useState<Draft>(() => draftOf(day));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusRef = useRef<HTMLInputElement>(null);
  const invalid = draft.focus.trim() === "" || !Number.isInteger(draft.minutes) || draft.minutes < 1 || draft.minutes > 24 * 60;

  useEffect(() => {
    focusRef.current?.focus();
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (invalid || same(draft, saved)) return;
    timer.current = setTimeout(() => {
      onSave(patchOf(saved, draft));
      setSaved(draft);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [draft, invalid, saved, onSave]);

  function done() {
    clearTimeout(timer.current);
    if (!invalid && !same(draft, saved)) onSave(patchOf(saved, draft));
    onClose();
  }

  const toggle = (id: string) => setDraft((d) => ({ ...d, question_ids: d.question_ids.includes(id) ? d.question_ids.filter((q) => q !== id) : [...d.question_ids, id] }));

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-ring/60 bg-card p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") done();
        if (event.key === "Enter" && (event.target === focusRef.current || (event.target as HTMLElement).id === `day-${day.day}-minutes`)) {
          event.preventDefault();
          done();
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`day-${day.day}-focus`}>Focus</Label>
          <Input ref={focusRef} id={`day-${day.day}-focus`} value={draft.focus} onChange={(e) => setDraft({ ...draft, focus: e.target.value })} aria-invalid={draft.focus.trim() === ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`day-${day.day}-minutes`}>Minutes</Label>
          <Input id={`day-${day.day}-minutes`} type="number" inputMode="numeric" min={1} max={1440} value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })} aria-invalid={!Number.isInteger(draft.minutes) || draft.minutes < 1} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Questions for this day</legend>
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-md border p-2 pb-3">
          {questions.map((q) => {
            const on = draft.question_ids.includes(q.id);
            return (
              <li key={q.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={on} onChange={() => toggle(q.id)} className="mt-1 accent-primary" />
                  <span className={on ? "" : "text-muted-foreground"}>{q.prompt}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {invalid ? "A focus and a number of minutes from 1 to 1440 are needed." : saving ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving</> : same(draft, saved) ? <><Check className="size-3.5" aria-hidden="true" /> Saved</> : "Saves as you type"}
        </p>
        <Button type="button" size="sm" onClick={done}>
          Done
        </Button>
      </div>
    </div>
  );
}
