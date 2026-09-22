import type { ItemMeta, Question, Requirement } from "@prepkit/core";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemBadges } from "./item-badges";

const DIFFICULTY = ["Easy", "Medium", "Hard"];

function Difficulty({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={DIFFICULTY[level - 1]}>
      <span className="sr-only">Difficulty: {DIFFICULTY[level - 1]}</span>
      {[1, 2, 3].map((n) => (
        <span key={n} aria-hidden="true" className={`size-1.5 rounded-full ${n <= level ? "bg-primary" : "bg-border"}`} />
      ))}
    </span>
  );
}

interface Props {
  question: Question;
  meta: ItemMeta;
  requirements: Map<string, Requirement>;
  onEdit?: () => void;
  onPin?: (pinned: boolean) => void;
  onDelete?: () => void;
}

export function QuestionCard({ question, meta, requirements, onEdit, onPin, onDelete }: Props) {
  return (
    <article aria-label={question.prompt} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="font-medium leading-snug">{question.prompt}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{question.answer_outline}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ItemBadges item={meta} />
        {question.requirement_ids.map((id) => (
          <span key={id} title={requirements.get(id)?.text} className="inline-flex h-5.5 items-center rounded-md border px-1.5 font-mono text-xs text-muted-foreground">
            {id}
          </span>
        ))}
        <Difficulty level={question.difficulty} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">{question.id}</span>
        {onPin && (
          <Button variant="ghost" size="icon-sm" onClick={() => onPin(!meta.pinned)} aria-pressed={meta.pinned} aria-label={meta.pinned ? `Unpin ${question.id}` : `Pin ${question.id}`} title={meta.pinned ? "Unpin" : "Pin, so a regeneration keeps it"}>
            {meta.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          </Button>
        )}
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${question.id}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${question.id}`} className="text-muted-foreground hover:text-destructive">
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  );
}
