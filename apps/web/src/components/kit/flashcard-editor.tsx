"use client";

import type { Flashcard, Requirement } from "@prepkit/core";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FlashcardDraft } from "@/lib/kit-edits";

// The flashcard twin of question-editor: a front, a back and the requirements it covers.

const AUTOSAVE_MS = 500;
const BLANK: FlashcardDraft = { front: "", back: "", requirement_ids: [] };
const draftOf = (f: Flashcard): FlashcardDraft => ({ front: f.front, back: f.back, requirement_ids: f.requirement_ids });
const same = (a: FlashcardDraft, b: FlashcardDraft) => JSON.stringify(a) === JSON.stringify(b);

function patchOf(saved: FlashcardDraft, draft: FlashcardDraft): Partial<FlashcardDraft> {
  const patch: Partial<FlashcardDraft> = {};
  if (draft.front !== saved.front) patch.front = draft.front;
  if (draft.back !== saved.back) patch.back = draft.back;
  if (draft.requirement_ids.join() !== saved.requirement_ids.join()) patch.requirement_ids = draft.requirement_ids;
  return patch;
}

interface Props {
  card: Flashcard | { id: string; isNew: true };
  requirements: Requirement[];
  saving: boolean;
  onSave: (patch: Partial<FlashcardDraft>) => void;
  onCreate?: (draft: FlashcardDraft) => void;
  onClose: () => void;
}

export function FlashcardEditor({ card, requirements, saving, onSave, onCreate, onClose }: Props) {
  const isNew = "isNew" in card;
  const [draft, setDraft] = useState<FlashcardDraft>(() => (isNew ? BLANK : draftOf(card)));
  const [saved, setSaved] = useState<FlashcardDraft>(() => (isNew ? BLANK : draftOf(card)));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const empty = draft.front.trim() === "" || draft.back.trim() === "";

  useEffect(() => {
    frontRef.current?.focus();
  }, []);

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
      if (empty) return;
      onCreate?.(draft);
    } else if (!empty && !same(draft, saved)) {
      onSave(patchOf(saved, draft));
    }
    onClose();
  }

  const toggle = (id: string) => setDraft((d) => ({ ...d, requirement_ids: d.requirement_ids.includes(id) ? d.requirement_ids.filter((r) => r !== id) : [...d.requirement_ids, id] }));

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-ring/60 bg-card p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") return isNew ? onClose() : done();
        if (event.key === "Enter" && !event.shiftKey && event.target === frontRef.current) {
          event.preventDefault();
          done();
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${card.id}-front`}>Front</Label>
        <Textarea ref={frontRef} id={`${card.id}-front`} rows={2} value={draft.front} onChange={(e) => setDraft({ ...draft, front: e.target.value })} aria-invalid={draft.front.trim() === ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${card.id}-back`}>Back</Label>
        <Textarea id={`${card.id}-back`} rows={3} value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })} aria-invalid={draft.back.trim() === ""} />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Covers</legend>
        <div className="flex flex-wrap gap-1.5">
          {requirements.map((r) => {
            const on = draft.requirement_ids.includes(r.id);
            return (
              <button key={r.id} type="button" aria-pressed={on} title={r.text} onClick={() => toggle(r.id)} className={`h-7 rounded-md border px-2 font-mono text-xs ${on ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground"}`}>
                {r.id}
              </button>
            );
          })}
          {requirements.length === 0 && <span className="text-sm text-muted-foreground">This kit has no requirements.</span>}
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {empty ? "A front and a back are both needed." : isNew ? "Added when you press Done" : saving ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving</> : same(draft, saved) ? <><Check className="size-3.5" aria-hidden="true" /> Saved</> : "Saves as you type"}
        </p>
        <div className="flex gap-2">
          {isNew && (
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="button" size="sm" onClick={done} disabled={isNew && empty}>
            {isNew ? "Add flashcard" : "Done"}
          </Button>
        </div>
      </div>
    </div>
  );
}
