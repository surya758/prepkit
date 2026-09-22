"use client";

import type { Kit, KitMeta, Question } from "@prepkit/core";
import { useState } from "react";
import { useEditKit } from "@/lib/builder";
import { metaFor } from "@/lib/item-meta";
import { QuestionCard } from "./question-card";
import { QuestionEditor, editQuestionOptimistically } from "./question-editor";

// The kit's own category order, which is also the order the pipeline plans them in.
export const CATEGORY_LABELS: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function QuestionsSection({ kitId, kit, meta }: { kitId: string; kit: Kit; meta: KitMeta | null }) {
  const requirements = new Map(kit.role.requirements.map((r) => [r.id, r]));
  const edit = useEditKit(kitId);
  // One question is edited at a time; the rest of the page stays as it is.
  const [editing, setEditing] = useState<string | null>(null);

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
                    {editing === question.id ? (
                      <QuestionEditor
                        question={question}
                        requirements={kit.role.requirements}
                        saving={edit.isPending}
                        onSave={(patch) =>
                          edit.mutate({ method: "PATCH", path: `/questions/${question.id}`, body: patch, optimistic: editQuestionOptimistically(question.id, patch), failed: "Your change to this question was not saved" })
                        }
                        onClose={() => setEditing(null)}
                      />
                    ) : (
                      <QuestionCard question={question} meta={metaFor(meta, question.id)} requirements={requirements} onEdit={() => setEditing(question.id)} />
                    )}
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
