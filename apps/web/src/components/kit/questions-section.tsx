"use client";

import type { Kit, KitMeta, Question } from "@prepkit/core";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useQuestionEdits } from "@/features/questions";
import { metaFor } from "@/lib/item-meta";
import { QuestionCard } from "./question-card";
import { QuestionEditor } from "./question-editor";

// The kit's own category order, which is also the order the pipeline plans them in.
export const CATEGORY_LABELS: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function QuestionsSection({ kitId, kit, meta }: { kitId: string; kit: Kit; meta: KitMeta | null }) {
  const requirements = new Map(kit.role.requirements.map((r) => [r.id, r]));
  const edits = useQuestionEdits(kitId);
  // Which editor or dialog is open. The only state a view owns.
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<Question["category"] | null>(null);
  const [deleting, setDeleting] = useState<Question | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this question?"
        description={deleting ? `“${deleting.prompt}” will be removed from the kit and from your schedule. This cannot be undone.` : ""}
        confirmLabel="Delete question"
        pending={edits.isPending && deleting !== null}
        onConfirm={() => deleting && edits.remove(deleting.id, { onSettled: () => setDeleting(null) })}
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
                        saving={edits.isPending}
                        onSave={(patch) => edits.edit(question.id, patch)}
                        onClose={() => setEditing(null)}
                      />
                    ) : (
                      <QuestionCard
                        question={question}
                        meta={metaFor(meta, question.id)}
                        requirements={requirements}
                        onEdit={() => setEditing(question.id)}
                        onPin={(pinned) => edits.pin(question.id, pinned)}
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
                      onCreate={(draft) => edits.add(category, draft)}
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
