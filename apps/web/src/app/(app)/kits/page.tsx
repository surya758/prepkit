"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { KitStatusBadge } from "@/components/kit-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { useKits } from "@/lib/kits";
import type { KitSummary } from "@/lib/kits";

export default function KitsPage() {
  const kits = useKits();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl">Your kits</h1>
        <Button asChild>
          <Link href="/kits/new">
            <Plus aria-hidden="true" />
            New kit
          </Link>
        </Button>
      </div>

      {kits.isPending ? (
        <ul aria-busy="true" aria-label="Loading your kits" className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </li>
          ))}
        </ul>
      ) : kits.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-card p-5">
          <p className="font-semibold">Your kits could not be loaded</p>
          <p className="text-sm text-muted-foreground">{kits.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => kits.refetch()} disabled={kits.isFetching}>
            Try again
          </Button>
        </div>
      ) : kits.data.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-8 text-center">
          <p className="font-display text-2xl">No kits yet</p>
          <p className="mx-auto max-w-md text-muted-foreground">
            A kit is built from a job description and the company&apos;s website: a brief, the questions to expect, flashcards and a day-by-day schedule.
          </p>
          <Button asChild className="mx-auto mt-2">
            <Link href="/kits/new">Create your first kit</Link>
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {kits.data.map((kit) => (
            <KitRow key={kit.id} kit={kit} />
          ))}
        </ul>
      )}
    </main>
  );
}

function KitRow({ kit }: { kit: KitSummary }) {
  return (
    <li>
      <Link
        href={`/kits/${kit.id}`}
        className="flex flex-col gap-2 rounded-xl border bg-card p-5 outline-none transition-colors hover:border-ring/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-lg leading-snug font-semibold break-words">{kit.title}</h2>
          <KitStatusBadge status={kit.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {kit.company && <>{kit.company} · </>}
          {kit.days} {kit.days === 1 ? "day" : "days"} · created {formatRelative(kit.createdAt)}
        </p>
        {kit.status === "failed" && kit.error && <p className="text-sm text-destructive">{kit.error.message}</p>}
      </Link>
    </li>
  );
}
