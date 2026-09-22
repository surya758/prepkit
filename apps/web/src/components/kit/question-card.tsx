import type { ItemMeta, Question, Requirement } from "@prepkit/core";
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
}

export function QuestionCard({ question, meta, requirements }: Props) {
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
      </div>
    </article>
  );
}
