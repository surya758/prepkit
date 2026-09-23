"use client";

import type { Question } from "@prepkit/core";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionDraft } from "@/lib/kit-edits";
import type { NumberedRequirement } from "@/lib/requirements";
import { RequirementChip } from "./requirement-chip";

const AUTOSAVE_MS = 500;
const DIFFICULTY = ["Easy", "Medium", "Hard"];

type Draft = QuestionDraft;
const draftOf = (q: Question): Draft => ({ prompt: q.prompt, answer_outline: q.answer_outline, difficulty: q.difficulty, requirement_ids: q.requirement_ids });
export const BLANK: Draft = { prompt: "", answer_outline: "", difficulty: 2, requirement_ids: [] };
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that differ from the saved question. Nothing to send when the user changed nothing. */
function patchOf(saved: Draft, draft: Draft): Partial<Draft> {
  const patch: Partial<Draft> = {};
  if (draft.prompt !== saved.prompt) patch.prompt = draft.prompt;
  if (draft.answer_outline !== saved.answer_outline) patch.answer_outline = draft.answer_outline;
  if (draft.difficulty !== saved.difficulty) patch.difficulty = draft.difficulty;
  if (draft.requirement_ids.join() !== saved.requirement_ids.join()) patch.requirement_ids = draft.requirement_ids;
  return patch;
}

interface Props {
  /** An existing question, or a blank draft for a new one; a new one is created once, on Done. */
  question: Question | { id: string; isNew: true };
  requirements: Map<string, NumberedRequirement>;
  saving: boolean;
  onSave: (patch: Partial<Draft>) => void;
  onCreate?: (draft: Draft) => void;
  onClose: () => void;
}

export function QuestionEditor({ question, requirements, saving, onSave, onCreate, onClose }: Props) {
  const isNew = "isNew" in question;
  // The editor owns the draft while open. What the server holds is only read again on close,
  // so a refetch cannot replace text mid-sentence.
  const [draft, setDraft] = useState<Draft>(() => (isNew ? BLANK : draftOf(question)));
  // What was last sent. State, not a ref: the status line renders from it.
  const [saved, setSaved] = useState<Draft>(() => (isNew ? BLANK : draftOf(question)));
  // As it was when the editor opened, for Undo changes: autosave means there is nothing unsaved
  // to cancel, so the way back is to save the original again.
  const [original] = useState<Draft>(() => (isNew ? BLANK : draftOf(question)));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const empty = draft.prompt.trim() === "" || draft.answer_outline.trim() === "";

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Autosave: after a pause in typing, send whatever differs from the last save. A new question
  // is not saved piecemeal; it is created whole, on Done.
  useEffect(() => {
    clearTimeout(timer.current);
    if (isNew || empty || same(draft, saved)) return;
    timer.current = setTimeout(() => {
      onSave(patchOf(saved, draft));
      setSaved(draft);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [draft, empty, isNew, saved, onSave]);

  function done() {
    clearTimeout(timer.current);
    if (isNew) {
      if (empty) return; // nothing worth creating; the status line says what is missing
      onCreate?.(draft);
    } else if (!empty && !same(draft, saved)) {
      onSave(patchOf(saved, draft));
    }
    onClose();
  }

  function undo() {
    clearTimeout(timer.current);
    if (!same(saved, original)) onSave(patchOf(saved, original));
    onClose();
  }

  const toggleRequirement = (id: string) =>
    setDraft((d) => ({ ...d, requirement_ids: d.requirement_ids.includes(id) ? d.requirement_ids.filter((r) => r !== id) : [...d.requirement_ids, id] }));

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-ring/60 bg-card p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") return isNew ? onClose() : done();
        // Enter in the one-line question field finishes; the outline keeps Enter for new lines.
        if (event.key === "Enter" && !event.shiftKey && event.target === promptRef.current) {
          event.preventDefault();
          done();
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${question.id}-prompt`}>Question</Label>
        <Textarea ref={promptRef} id={`${question.id}-prompt`} rows={2} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} aria-invalid={draft.prompt.trim() === ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${question.id}-outline`}>Answer outline</Label>
        <Textarea id={`${question.id}-outline`} rows={3} value={draft.answer_outline} onChange={(e) => setDraft({ ...draft, answer_outline: e.target.value })} aria-invalid={draft.answer_outline.trim() === ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 text-sm font-medium">Difficulty</legend>
          <div role="group" className="inline-flex self-start rounded-lg bg-muted p-0.5">
            {[1, 2, 3].map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={draft.difficulty === level}
                onClick={() => setDraft({ ...draft, difficulty: level })}
                className={`h-8 rounded-md px-3 text-sm font-medium ${draft.difficulty === level ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                {DIFFICULTY[level - 1]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 text-sm font-medium">Covers</legend>
          <div className="flex flex-wrap gap-1.5">
            {[...requirements].map(([id, r]) => (
              <RequirementChip key={id} id={id} requirement={r} pressed={draft.requirement_ids.includes(id)} onToggle={() => toggleRequirement(id)} />
            ))}
            {requirements.size === 0 && <span className="text-sm text-muted-foreground">This kit has no requirements.</span>}
          </div>
        </fieldset>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {empty ? "A question and an outline are both needed." : isNew ? "Added when you press Add question" : saving ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving</> : same(draft, saved) ? <><Check className="size-3.5" aria-hidden="true" /> Saved</> : "Saves as you type"}
        </p>
        <div className="flex gap-2">
          {isNew ? (
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            !same(draft, original) && (
              <Button type="button" size="sm" variant="ghost" onClick={undo}>
                Undo changes
              </Button>
            )
          )}
          <Button type="button" size="sm" onClick={done} disabled={isNew && empty}>
            {isNew ? "Add question" : "Done"}
          </Button>
        </div>
      </div>
    </div>
  );
}

