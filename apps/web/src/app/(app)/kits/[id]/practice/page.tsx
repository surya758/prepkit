"use client";

import type { Confidence } from "@prepkit/core";
import Link from "next/link";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CardStepper } from "@/components/practice/card-stepper";
import { CoveragePanel } from "@/components/practice/coverage-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePracticeView,
  useRateCard,
  useResetPractice,
} from "@/features/practice";
import { ApiError } from "@/lib/api";
import { kitTitle, useKit } from "@/lib/kits";
import * as session from "@/lib/practice-session";
import type { Session } from "@/lib/practice-session";

const KIT_TABS = ["brief", "role", "questions", "flashcards", "schedule"];

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  // Back goes to the tab Practise was pressed on; opened by address, to the flashcards.
  const from = useSearchParams().get("from");
  const backTab = from && KIT_TABS.includes(from) ? from : "flashcards";
  const kit = useKit(id);
  const view = usePracticeView(id);
  const rating = useRateCard(id);
  const reset = useResetPractice(id);
  const [resetting, setResetting] = useState(false);
  // The sitting is taken from the server's order once, when it begins; ratings update progress
  // only. Until the user has done anything, the sitting simply IS the first order that arrived,
  // so there is no state to set when data lands.
  const [progressed, setProgressed] = useState<Session | null>(null);
  const started = useMemo(
    () => (view.data ? session.start(view.data.order) : null),
    [view.data],
  );
  // A card deleted in the builder in another tab drops out of the sitting: derived, not stored.
  const sitting = useMemo(() => {
    const base = progressed ?? started;
    if (!base || !kit.data?.kit) return base;
    const present = new Set(kit.data.kit.flashcards.map((f) => f.id));
    const missing = new Set(
      base.order.filter((cardId) => !present.has(cardId)),
    );
    return missing.size > 0 ? session.withoutCards(base, missing) : base;
  }, [progressed, started, kit.data]);

  const reveal = useCallback(
    () => setProgressed(sitting && session.reveal(sitting)),
    [sitting],
  );
  const skip = useCallback(
    () => setProgressed(sitting && session.skip(sitting)),
    [sitting],
  );
  const rate = useCallback(
    (confidence: Confidence) => {
      const cardId = sitting ? session.currentCard(sitting) : null;
      if (!cardId || !sitting) return;
      rating.mutate({ cardId, confidence });
      setProgressed(session.rate(sitting, confidence));
    },
    [sitting, rating],
  );

  const error = kit.error ?? view.error;
  if (error instanceof ApiError && error.status === 404) notFound();
  if (error instanceof ApiError && error.status === 409) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-10 sm:px-8">
        <h1 className="font-display text-4xl">Not ready to practise yet</h1>
        <p className="text-muted-foreground">{error.message}</p>
        <Button asChild className="self-start">
          <Link href={`/kits/${id}`}>Back to the kit</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href={`/kits/${id}?tab=${backTab}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← {kit.data ? kitTitle(kit.data) : "The kit"}
          </Link>
          <h1 className="font-display text-4xl">Practice</h1>
        </div>
        {view.data && view.data.progress.practised > 0 && (
          <Button
            id="start-over"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setResetting(true)}
          >
            Start over
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        // A reset removes Start over (nothing left to undo), so focus goes to the card instead.
        focusOnClose="#start-over, #show-answer"
        title="Start over?"
        description="Every rating you have given on this kit's cards is forgotten, and the next sitting begins from the first card again. The cards themselves are not touched."
        confirmLabel="Forget my ratings"
        cancelLabel="Keep them"
        pending={reset.isPending}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: ({ practice }) => {
              setResetting(false);
              setProgressed(session.start(practice.order));
            },
          })
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          {!kit.data?.kit || !view.data || !sitting ? (
            error ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-card p-5"
              >
                <p className="font-semibold">Practice could not be loaded</p>
                <p className="text-sm text-muted-foreground">{error.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (kit.isError ? kit.refetch() : view.refetch())}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <div
                aria-busy="true"
                aria-label="Loading practice"
                className="flex flex-col gap-4"
              >
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-72 w-full rounded-2xl" />
              </div>
            )
          ) : session.isFinished(sitting) ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-6">
              <h2 className="font-display text-2xl">
                {sitting.order.length === 0
                  ? "Nothing to practise"
                  : "That's the sitting done"}
              </h2>
              <p className="text-muted-foreground">
                {sitting.order.length === 0
                  ? "This kit has no flashcards. Add some in the builder."
                  : `You rated ${Object.keys(sitting.rated).length} of ${sitting.order.length} cards. The next sitting starts with any you have not seen, then the ones you found hardest.`}
              </p>
              <div className="flex gap-2">
                {sitting.order.length > 0 && (
                  <Button
                    onClick={() =>
                      setProgressed(session.start(view.data.order))
                    }
                  >
                    Go again
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href={`/kits/${id}?tab=${backTab}`}>
                    Back to the kit
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <CardStepper
              session={sitting}
              cards={new Map(kit.data.kit.flashcards.map((f) => [f.id, f]))}
              onReveal={reveal}
              onRate={rate}
              onSkip={skip}
            />
          )}
        </div>
        {kit.data?.kit && view.data && (
          <CoveragePanel
            progress={view.data.progress}
            requirements={kit.data.kit.role.requirements}
          />
        )}
      </div>
    </main>
  );
}
