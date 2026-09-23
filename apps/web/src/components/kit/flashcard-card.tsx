import type { Flashcard, ItemMeta, Requirement } from "@prepkit/core";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemBadges } from "./item-badges";
import { DragHandle } from "./sortable-list";
import type { HandleProps } from "./sortable-list";

interface Props {
  card: Flashcard;
  meta: ItemMeta;
  requirements: Map<string, Requirement>;
  handle: HandleProps;
  onEdit: () => void;
  onPin: (pinned: boolean) => void;
  onDelete: () => void;
}

export function FlashcardCard({ card, meta, requirements, handle, onEdit, onPin, onDelete }: Props) {
  return (
    <article aria-label={card.front} className="flex gap-2 rounded-xl border bg-card p-4">
      <DragHandle handle={handle} label={`Reorder ${card.id}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="font-medium leading-snug">{card.front}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{card.back}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ItemBadges item={meta} />
          {card.requirement_ids.map((id) => (
            <span key={id} title={requirements.get(id)?.text} className="inline-flex h-5.5 items-center rounded-md border px-1.5 font-mono text-xs text-muted-foreground">
              {id}
            </span>
          ))}
          <span className="ml-auto" />
          <Button variant="ghost" size="icon-sm" onClick={() => onPin(!meta.pinned)} aria-pressed={meta.pinned} aria-label={meta.pinned ? `Unpin ${card.id}` : `Pin ${card.id}`} title={meta.pinned ? "Unpin" : "Pin, so a regeneration keeps it"}>
            {meta.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${card.id}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${card.id}`} className="text-muted-foreground hover:text-destructive">
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}
