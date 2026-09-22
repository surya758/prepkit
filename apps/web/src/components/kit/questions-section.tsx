import type { Kit, KitMeta, Question } from "@prepkit/core";
import { metaFor } from "@/lib/item-meta";
import { QuestionCard } from "./question-card";

// The kit's own category order, which is also the order the pipeline plans them in.
export const CATEGORY_LABELS: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function QuestionsSection({ kit, meta }: { kit: Kit; meta: KitMeta | null }) {
  const requirements = new Map(kit.role.requirements.map((r) => [r.id, r]));

  if (kit.questions.length === 0) {
    return <p className="rounded-xl border border-dashed p-5 text-muted-foreground">This kit has no questions.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {(Object.keys(CATEGORY_LABELS) as Question["category"][]).map((category) => {
        const questions = kit.questions.filter((q) => q.category === category);
        return (
          <section key={category} aria-labelledby={`questions-${category}`} className="flex flex-col gap-3">
            <h2 id={`questions-${category}`} className="font-display text-2xl">
              {CATEGORY_LABELS[category]} <span className="font-sans text-sm text-muted-foreground">{questions.length}</span>
            </h2>
            {questions.length === 0 ? (
              // Still listed, so the absence is a fact on the page and, later, a place to add or regenerate.
              <p className="text-sm text-muted-foreground">None planned for this role.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {questions.map((question) => (
                  <li key={question.id}>
                    <QuestionCard question={question} meta={metaFor(meta, question.id)} requirements={requirements} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
