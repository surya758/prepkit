"use client";

import { Ban, Check, CircleStop, LoaderCircle, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { StepState, TimelineStep } from "@/lib/timeline";

const LOOK: Record<StepState, { icon: typeof Check; word: string; className: string }> = {
  done: { icon: Check, word: "Done", className: "bg-success text-success-foreground" },
  running: { icon: LoaderCircle, word: "In progress", className: "bg-accent text-accent-foreground" },
  skipped: { icon: Ban, word: "Skipped", className: "bg-warning text-warning-foreground" },
  failed: { icon: X, word: "Failed", className: "bg-destructive/15 text-destructive" },
  stopped: { icon: CircleStop, word: "Did not finish", className: "bg-muted text-muted-foreground" },
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function GenerationTimeline({ steps }: { steps: TimelineStep[] }) {
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">Waiting for a free slot. Kits are generated two at a time.</p>;

  return (
    <ol className="flex flex-col">
      {/* initial={false}: rows already there when the page opens do not animate — a finished
          kit's thirteen steps should not perform on every visit. Only a step that arrives
          while you are watching slides in. */}
      <AnimatePresence initial={false}>
        {steps.map((step) => {
        const { icon: Icon, word, className } = LOOK[step.state];
        return (
          <m.li
            key={step.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex gap-3 border-b py-3 last:border-b-0"
          >
            {/* Keyed by state, so the moment a step finishes its mark is replaced and pops in. */}
            <m.span
              key={step.state}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${className}`}
            >
              <Icon className={`size-3.5 ${step.state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </m.span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={step.state === "running" ? "font-semibold" : ""}>
                  {step.label}
                  {/* The icon is decoration; this is what a screen reader gets. */}
                  <span className="sr-only"> — {word}</span>
                </span>
                {step.state === "done" && step.durationMs !== undefined && step.durationMs >= 100 && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{seconds(step.durationMs)}</span>
                )}
                {step.state !== "done" && step.state !== "running" && <span className="shrink-0 text-xs text-muted-foreground">{word}</span>}
              </div>
              {step.detail && step.state !== "done" && <p className="text-sm text-muted-foreground">{step.detail}</p>}
            </div>
          </m.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
