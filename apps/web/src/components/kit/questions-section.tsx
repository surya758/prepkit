"use client";

import type { Kit, KitMeta, Question } from "@prepkit/core";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useEditKit } from "@/lib/builder";
import { metaFor } from "@/lib/item-meta";
import { QuestionCard } from "./question-card";
import { QuestionEditor, editQuestionOptimistically } from "./question-editor";
import type { Draft } from "./question-editor";

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
  const [adding, setAdding] = useState<Question["category"] | null>(null);
  const [deleting, setDeleting] = useState<Question | null>(null);

  const pin = (id: string, pinned: boolean) =>
    edit.mutate({
      method: "PUT",
      path: `/items/${id}/pin`,
      body: { pinned },
      optimistic: ({ kit, meta }) => ({ kit, meta: { ...meta, items: { ...meta.items, [id]: { ...metaFor(meta, id), pinned } } } }),
      failed: pinned ? "This question could not be pinned" : "This question could not be unpinned",
    });

  const create = (category: Question["category"], draft: Draft) =>
    edit.mutate({
      method: "POST",
      path: "/questions",
      body: { ...draft, category },
      // The id the server will give it, so the card can appear at once and keep its place when the answer lands.
      optimistic: ({ kit, meta }) => {
        const id = `q${meta.nextQuestion}`;
        return {
          kit: { ...kit, questions: [...kit.questions, { id, category, ...draft }] },
          meta: { ...meta, nextQuestion: meta.nextQuestion + 1, items: { ...meta.items, [id]: { origin: "user", edited: false, pinned: false } } },
        };
      },
      failed: "Your question could not be added",
    });

  const remove = (question: Question) =>
    edit.mutate(
      {
        method: "DELETE",
        path: `/questions/${question.id}`,
        optimistic: ({ kit, meta }) => {
          const items = { ...meta.items };
          delete items[question.id];
          return { kit: { ...kit, questions: kit.questions.filter((q) => q.id !== question.id) }, meta: { ...meta, items } };
        },
        failed: "This question could not be deleted",
      },
      { onSettled: () => setDeleting(null) },
    );

  return (
    <div className="flex flex-col gap-8">
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this question?"
        description={deleting ? `“${deleting.prompt}” will be removed from the kit and from your schedule. This cannot be undone.` : ""}
        confirmLabel="Delete question"
        pending={edit.isPending && deleting !== null}
        onConfirm={() => deleting && remove(deleting)}
      />
      {(Object.keys(CATEGORY_LABELS) as Question["category"][]).map((category) => {
        const questions = kit.questions.filter((q) => q.category === category);
        return (
          <section key={category} aria-labelledby={`questions-${category}`} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id={`questions-${category}`} className="font-display text-2xl">
                {CATEGORY_LABELS[category]} <span className="font-sans text-sm text-muted-foreground">{questions.length}</span>
              </h2>
              <Button variant="outline" size="sm" onClick={() => setAdding(category)} disabled={adding === category}>
                <Plus aria-hidden="true" />
                Add question
              </Button>
            </div>
            {questions.length === 0 && adding !== category ? (
              // Still listed, so the absence is a fact on the page and a place to add or regenerate.
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
                      <QuestionCard
                        question={question}
                        meta={metaFor(meta, question.id)}
                        requirements={requirements}
                        onEdit={() => setEditing(question.id)}
                        onPin={(pinned) => pin(question.id, pinned)}
                        onDelete={() => setDeleting(question)}
                      />
                    )}
                  </li>
                ))}
                {adding === category && (
                  <li>
                    <QuestionEditor
                      question={{ id: `new-${category}`, isNew: true }}
                      requirements={kit.role.requirements}
                      saving={false}
                      onSave={() => {}}
                      onCreate={(draft) => create(category, draft)}
                      onClose={() => setAdding(null)}
                    />
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
