"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const AUTOSAVE_MS = 500;

interface Props {
  id: string;
  label: string;
  value: string;
  saving: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
}

/** One brief field, edited in place. Saves after a pause in typing, like the question editor; Done or Escape closes. */
export function BriefFieldEditor({ id, label, value, saving, onSave, onClose }: Props) {
  // The editor owns the draft while open, so a refetch cannot replace text mid-sentence.
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  // As it was when the editor opened, for Undo changes (see question-editor).
  const [original] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = draft.trim() === "";

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (empty || draft === saved) return;
    timer.current = setTimeout(() => {
      onSave(draft);
      setSaved(draft);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [draft, empty, saved, onSave]);

  function done() {
    clearTimeout(timer.current);
    if (!empty && draft !== saved) onSave(draft);
    onClose();
  }

  function undo() {
    clearTimeout(timer.current);
    if (saved !== original) onSave(original);
    onClose();
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-ring/60 bg-card p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") done();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Textarea ref={field} id={id} rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={empty} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {empty ? "This cannot be empty." : saving ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving</> : draft === saved ? <><Check className="size-3.5" aria-hidden="true" /> Saved</> : "Saves as you type"}
        </p>
        <div className="flex gap-2">
          {draft !== original && (
            <Button type="button" size="sm" variant="ghost" onClick={undo}>
              Undo changes
            </Button>
          )}
          <Button type="button" size="sm" onClick={done}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
