"use client";

import type { Question, Requirement } from "@prepkit/core";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EditRequest } from "@/lib/builder";

const AUTOSAVE_MS = 500;
const DIFFICULTY = ["Easy", "Medium", "Hard"];

type Draft = Pick<Question, "prompt" | "answer_outline" | "difficulty" | "requirement_ids">;
const draftOf = (q: Question): Draft => ({ prompt: q.prompt, answer_outline: q.answer_outline, difficulty: q.difficulty, requirement_ids: q.requirement_ids });
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

/** The change to the cached kit, so the card reflects the edit before the server answers. */
export function editQuestionOptimistically(id: string, patch: Partial<Draft>): NonNullable<EditRequest["optimistic"]> {
  return ({ kit, meta }) => ({
    kit: { ...kit, questions: kit.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) },
    meta: { ...meta, items: { ...meta.items, [id]: { ...(meta.items[id] ?? { origin: "generated", pinned: false }), edited: true } } },
  });
}

interface Props {
  question: Question;
  requirements: Requirement[];
  saving: boolean;
  onSave: (patch: Partial<Draft>) => void;
  onClose: () => void;
}

export function QuestionEditor({ question, requirements, saving, onSave, onClose }: Props) {
  // The editor owns the draft while open. What the server holds is only read again on close,
  // so a refetch cannot replace text mid-sentence.
  const [draft, setDraft] = useState<Draft>(() => draftOf(question));
  // What was last sent. State, not a ref: the status line renders from it.
  const [saved, setSaved] = useState<Draft>(() => draftOf(question));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const empty = draft.prompt.trim() === "" || draft.answer_outline.trim() === "";

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Autosave: after a pause in typing, send whatever differs from the last save.
  useEffect(() => {
    clearTimeout(timer.current);
    if (empty || same(draft, saved)) return;
    timer.current = setTimeout(() => {
      onSave(patchOf(saved, draft));
      setSaved(draft);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [draft, empty, saved, onSave]);

  function done() {
    clearTimeout(timer.current);
    if (!empty && !same(draft, saved)) onSave(patchOf(saved, draft));
    onClose();
  }

  const toggleRequirement = (id: string) =>
    setDraft((d) => ({ ...d, requirement_ids: d.requirement_ids.includes(id) ? d.requirement_ids.filter((r) => r !== id) : [...d.requirement_ids, id] }));

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-ring/60 bg-card p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") done();
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
          <legend className="text-sm font-medium">Difficulty</legend>
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
          <legend className="text-sm font-medium">Covers</legend>
          <div className="flex flex-wrap gap-1.5">
            {requirements.map((r) => {
              const on = draft.requirement_ids.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  title={r.text}
                  onClick={() => toggleRequirement(r.id)}
                  className={`h-7 rounded-md border px-2 font-mono text-xs ${on ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground"}`}
                >
                  {r.id}
                </button>
              );
            })}
            {requirements.length === 0 && <span className="text-sm text-muted-foreground">This kit has no requirements.</span>}
          </div>
        </fieldset>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {empty ? "A question and an outline are both needed." : saving ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving</> : same(draft, saved) ? <><Check className="size-3.5" aria-hidden="true" /> Saved</> : "Saves as you type"}
        </p>
        <Button type="button" size="sm" onClick={done}>
          Done
        </Button>
      </div>
    </div>
  );
}

