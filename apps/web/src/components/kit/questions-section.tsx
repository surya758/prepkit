"use client";

import type { Kit, KitMeta, Question } from "@prepkit/core";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { focusAfterRender } from "@/components/focus-after-render";
import { Button } from "@/components/ui/button";
import { useQuestionEdits } from "@/features/questions";
import { useRegenerate } from "@/features/regenerate";
import { excerpt } from "@/lib/format";
import { isKept, metaFor } from "@/lib/item-meta";
import { numberRequirements } from "@/lib/requirements";
import { QuestionCard } from "./question-card";
import { QuestionEditor } from "./question-editor";
import { SortableList } from "./sortable-list";

// The kit's own category order, which is also the order the pipeline plans them in.
export const CATEGORY_LABELS: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function QuestionsSection({
  kitId,
  kit,
  meta,
}: {
  kitId: string;
  kit: Kit;
  meta: KitMeta | null;
}) {
  const requirements = numberRequirements(kit.role.requirements);
  const edits = useQuestionEdits(kitId);
  const regen = useRegenerate(kitId);
  // Which editor or dialog is open — the only state a view owns. For the editor, also whether the
  // question was untouched then: an undo clears the edited flag only in that case, since otherwise
  // it would go back to an earlier edit of the user's.
  const [editing, setEditing] = useState<{ id: string; wasUntouched: boolean } | null>(null);
  const [adding, setAdding] = useState<Question["category"] | null>(null);
  const [deleting, setDeleting] = useState<Question | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this question?"
        description={
          deleting
            ? `“${excerpt(deleting.prompt)}” will be removed from the kit and from your schedule. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete question"
        pending={edits.isPending && deleting !== null}
        onConfirm={() =>
          deleting &&
          edits.remove(deleting.id, {
            onSettled: () => {
              // The deleted card's controls are gone; the section's own button is the nearest one left.
              focusAfterRender(`#add-question-${deleting.category}`);
              setDeleting(null);
            },
          })
        }
      />
      {(Object.keys(CATEGORY_LABELS) as Question["category"][]).map(
        (category) => {
          const questions = kit.questions.filter(
            (q) => q.category === category,
          );
          const target = { section: "questions", category } as const;
          const running = regen.isRunning(target);
          const refusal = regen.refusal(target);
          const kept = questions.filter((q) =>
            isKept(metaFor(meta, q.id)),
          ).length;
          return (
            <section
              key={category}
              aria-labelledby={`questions-${category}`}
              className="flex flex-col gap-3"
            >
              {/* Wraps on a phone: the heading stays whole and the buttons drop below it. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id={`questions-${category}`}
                  className="font-display text-2xl whitespace-nowrap"
                >
                  {CATEGORY_LABELS[category]}{" "}
                  <span className="font-sans text-sm text-muted-foreground">
                    {questions.length}
                  </span>
                </h2>
                <div className="flex gap-2">
                  <Button
                    id={`add-question-${category}`}
                    variant="outline"
                    size="sm"
                    onClick={() => setAdding(category)}
                    disabled={adding === category}
                  >
                    <Plus aria-hidden="true" />
                    Add question
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => regen.regenerate(target)}
                    disabled={running}
                    aria-describedby={`regen-note-${category}`}
                  >
                    {running ? (
                      <LoaderCircle
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <RefreshCw aria-hidden="true" />
                    )}
                    {running ? "Regenerating" : "Regenerate"}
                  </Button>
                </div>
              </div>
              {/* What a regeneration will do, said before it is pressed: the rule the badges show, in a sentence. */}
              <p
                id={`regen-note-${category}`}
                role={running ? "status" : undefined}
                className="text-sm text-muted-foreground"
              >
                {running
                  ? `Asking for fresh ${CATEGORY_LABELS[category].toLowerCase()} questions. ${kept === 0 ? "Everything here will be replaced." : `The ${kept} you edited, wrote or pinned stay exactly as they are.`} You can keep editing meanwhile.`
                  : questions.length === 0
                    ? "Regenerate asks the model to write questions for this category."
                    : kept === 0
                      ? "Regenerate replaces all of these. Edit or pin a question to keep it."
                      : kept === questions.length
                        ? "Every question here is yours, edited or pinned, so Regenerate would keep them all and add nothing."
                        : `Regenerate replaces the ${questions.length - kept} generated ${questions.length - kept === 1 ? "question" : "questions"} and keeps the ${kept} you edited, wrote or pinned.`}
              </p>
              {refusal && (
                <p
                  role="alert"
                  className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
                >
                  {refusal}
                </p>
              )}
              {questions.length === 0 && adding !== category ? (
                // Still listed, so the absence is a fact on the page and a place to add or regenerate.
                <p className="text-sm text-muted-foreground">
                  None planned for this role.
                </p>
              ) : (
                <>
                  <SortableList
                    items={questions}
                    describe={(q) => `the question “${q.prompt.slice(0, 60)}”`}
                    onReorder={edits.reorder}
                  >
                    {(question, handle) => {
                      const at = questions.findIndex(
                        (q) => q.id === question.id,
                      );
                      const swap = (other: number) => {
                        const ids = questions.map((q) => q.id);
                        [ids[at], ids[other]] = [ids[other]!, ids[at]!];
                        edits.reorder(ids);
                      };
                      return editing?.id === question.id ? (
                        <QuestionEditor
                          question={question}
                          requirements={requirements}
                          saving={edits.isPending}
                          onSave={(patch) => edits.edit(question.id, patch)}
                          onUndo={(patch) => edits.undo(question.id, patch, editing.wasUntouched)}
                          onClose={() => {
                            setEditing(null);
                            focusAfterRender(`[aria-label="Edit ${question.id}"]`);
                          }}
                        />
                      ) : (
                        <QuestionCard
                          question={question}
                          meta={metaFor(meta, question.id)}
                          requirements={requirements}
                          onEdit={() => setEditing({ id: question.id, wasUntouched: !metaFor(meta, question.id).edited })}
                          onPin={(pinned) => edits.pin(question.id, pinned)}
                          onDelete={() => setDeleting(question)}
                          handle={handle}
                          moves={{
                            up: at > 0 ? () => swap(at - 1) : null,
                            down:
                              at < questions.length - 1
                                ? () => swap(at + 1)
                                : null,
                            toCategory: (c) => edits.move(question.id, c),
                          }}
                        />
                      );
                    }}
                  </SortableList>
                  <ul>
                    {adding === category && (
                      <li>
                        <QuestionEditor
                          question={{ id: `new-${category}`, isNew: true }}
                          requirements={requirements}
                          saving={false}
                          onSave={() => {}}
                          onCreate={(draft) => edits.add(category, draft)}
                          onClose={() => {
                            setAdding(null);
                            focusAfterRender(`#add-question-${category}`);
                          }}
                        />
                      </li>
                    )}
                  </ul>
                </>
              )}
            </section>
          );
        },
      )}
    </div>
  );
}
