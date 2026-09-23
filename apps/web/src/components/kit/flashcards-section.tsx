"use client";

import type { Flashcard, Kit, KitMeta } from "@prepkit/core";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { focusAfterRender } from "@/components/focus-after-render";
import { Button } from "@/components/ui/button";
import { useFlashcardEdits } from "@/features/flashcards";
import { excerpt } from "@/lib/format";
import { metaFor } from "@/lib/item-meta";
import { numberRequirements } from "@/lib/requirements";
import { FlashcardCard } from "./flashcard-card";
import { FlashcardEditor } from "./flashcard-editor";
import { SortableList } from "./sortable-list";

export function FlashcardsSection({ kitId, kit, meta }: { kitId: string; kit: Kit; meta: KitMeta | null }) {
  const requirements = numberRequirements(kit.role.requirements);
  const edits = useFlashcardEdits(kitId);
  // Which editor or dialog is open. The only state a view owns.
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Flashcard | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this flashcard?"
        description={deleting ? `“${excerpt(deleting.front)}” will be removed from the kit, along with any practice progress on it. This cannot be undone.` : ""}
        confirmLabel="Delete flashcard"
        pending={edits.isPending && deleting !== null}
        onConfirm={() =>
          deleting &&
          edits.remove(deleting.id, {
            onSettled: () => {
              // The deleted card's controls are gone; the section's own button is the nearest one left.
              focusAfterRender("#add-flashcard");
              setDeleting(null);
            },
          })
        }
      />

      {/* Wraps on a phone: the heading stays whole and the button drops below it. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl whitespace-nowrap">
          Flashcards <span className="font-sans text-sm text-muted-foreground">{kit.flashcards.length}</span>
        </h2>
        <Button id="add-flashcard" variant="outline" size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <Plus aria-hidden="true" />
          Add flashcard
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Two per requirement and a few about the company, for practice mode. Drag to set the order they are shown in.</p>

      {kit.flashcards.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed p-5 text-muted-foreground">This kit has no flashcards. Add one, or they are written when the kit is generated.</p>
      ) : (
        <>
          <SortableList items={kit.flashcards} describe={(f) => `the card “${f.front.slice(0, 60)}”`} onReorder={edits.reorder}>
            {(card, handle) =>
              editing === card.id ? (
                <FlashcardEditor card={card} requirements={requirements} saving={edits.isPending} onSave={(patch) => edits.edit(card.id, patch)} onClose={() => { setEditing(null); focusAfterRender(`[aria-label="Edit ${card.id}"]`); }} />
              ) : (
                <FlashcardCard card={card} meta={metaFor(meta, card.id)} requirements={requirements} handle={handle} onEdit={() => setEditing(card.id)} onPin={(pinned) => edits.pin(card.id, pinned)} onDelete={() => setDeleting(card)} />
              )
            }
          </SortableList>
          {adding && (
            <FlashcardEditor card={{ id: "new-flashcard", isNew: true }} requirements={requirements} saving={false} onSave={() => {}} onCreate={(draft) => edits.add(draft)} onClose={() => { setAdding(false); focusAfterRender("#add-flashcard"); }} />
          )}
        </>
      )}
    </div>
  );
}
