"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { DeleteKitButton } from "@/components/delete-kit-button";
import { GenerationTimeline } from "@/components/generation-timeline";
import { KitStatusBadge } from "@/components/kit-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { isGenerating, kitTitle, useKit, useRetryKit } from "@/lib/kits";
import type { KitDetail } from "@/lib/kits";
import { buildTimeline } from "@/lib/timeline";

export default function KitPage() {
  const { id } = useParams<{ id: string }>();
  const [deleting, setDeleting] = useState(false);
  const kit = useKit(id, { enabled: !deleting });

  // A kit that does not exist and a kit that is someone else's get the same answer from the API.
  if (kit.error instanceof ApiError && kit.error.status === 404) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/kits" className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Your kits
      </Link>

      {kit.isPending ? (
        <div aria-busy="true" aria-label="Loading the kit" className="flex flex-col gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : kit.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-card p-5">
          <p className="font-semibold">This kit could not be loaded</p>
          <p className="text-sm text-muted-foreground">{kit.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => kit.refetch()} disabled={kit.isFetching}>
            Try again
          </Button>
        </div>
      ) : (
        <Loaded kit={kit.data} onDeleting={setDeleting} />
      )}
    </main>
  );
}

function Loaded({ kit, onDeleting }: { kit: KitDetail; onDeleting: (deleting: boolean) => void }) {
  const retry = useRetryKit(kit.id);
  const generating = isGenerating(kit);
  const steps = buildTimeline(kit.progress, generating);
  const done = steps.filter((step) => step.state === "done").length;

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 font-display text-4xl leading-tight break-words">{kitTitle(kit)}</h1>
          <KitStatusBadge status={kit.status} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {kit.kit?.source.company && <>{kit.kit.source.company} · </>}
            {kit.input.days} {kit.input.days === 1 ? "day" : "days"} to prepare
          </p>
          <DeleteKitButton kitId={kit.id} title={kitTitle(kit)} onDeleting={onDeleting} />
        </div>
      </header>

      {kit.status === "failed" && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-card p-5">
          <p className="font-semibold">This kit could not be generated</p>
          <p className="text-sm text-muted-foreground">{kit.error?.message ?? "Something went wrong."}</p>
          {retry.error && <p className="text-sm text-destructive">{retry.error.message}</p>}
          <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Try again
          </Button>
        </div>
      )}

      {kit.status === "ready" && kit.kit && (
        <section aria-labelledby="ready-heading" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <h2 id="ready-heading" className="font-display text-2xl">
            Your kit is ready
          </h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Requirements", kit.kit.role.requirements.length],
              ["Questions", kit.kit.questions.length],
              ["Flashcards", kit.kit.flashcards.length],
              ["Days planned", kit.kit.schedule.days.length],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dd className="font-display text-3xl">{value}</dd>
                <dt className="text-sm text-muted-foreground">{label}</dt>
              </div>
            ))}
          </dl>
          {kit.kit.warnings && kit.kit.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 border-t pt-4 text-sm text-muted-foreground">
              {kit.kit.warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="steps-heading" className="font-display text-2xl">
            {generating ? "Building your kit" : "How this kit was built"}
          </h2>
          {/* Announced politely as it changes; the list itself is not, or every row would be read out again. */}
          <p role="status" className="text-sm text-muted-foreground">
            {steps.length > 0 && `${done} of ${steps.length} steps done`}
          </p>
        </div>
        {generating && <p className="text-sm text-muted-foreground">This takes about half a minute. You can leave the page; it keeps going.</p>}
        <GenerationTimeline steps={steps} />
      </section>
    </>
  );
}
