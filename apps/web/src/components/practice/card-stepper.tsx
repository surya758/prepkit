"use client";

import type { Confidence, Flashcard, Requirement } from "@prepkit/core";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/practice-session";
import { currentCard } from "@/lib/practice-session";

const RATINGS: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: "Forgot", hint: "Could not answer" },
  { value: 2, label: "Shaky", hint: "Partly, with effort" },
  { value: 3, label: "Good", hint: "Got it, with a pause" },
  { value: 4, label: "Easy", hint: "Straight away" },
];

interface Props {
  session: Session;
  cards: Map<string, Flashcard>;
  requirements: Map<string, Requirement>;
  onReveal: () => void;
  onRate: (confidence: Confidence) => void;
  onSkip: () => void;
}

export function CardStepper({ session, cards, requirements, onReveal, onRate, onSkip }: Props) {
  const id = currentCard(session);
  const card = id ? cards.get(id) : undefined;

  // Space reveals, 1 to 4 rate, S skips. Only while nothing else has the keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [role=dialog], [role=alertdialog], [contenteditable]")) return;
      if (event.key === " ") {
        event.preventDefault();
        if (!session.revealed) onReveal();
      } else if (["1", "2", "3", "4"].includes(event.key) && session.revealed) {
        onRate(Number(event.key) as Confidence);
      } else if (event.key.toLowerCase() === "s" && !session.revealed) {
        onSkip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.revealed, onReveal, onRate, onSkip]);

  if (!card) return null;
  const position = session.at + 1;

  return (
    <section aria-label={`Card ${position} of ${session.order.length}`} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-sm font-semibold text-muted-foreground">
          Card {position} of {session.order.length}
        </span>
        <div aria-hidden="true" className="flex flex-1 gap-1">
          {session.order.map((cardId, index) => (
            <span key={cardId} className={`h-1.5 flex-1 rounded-full ${index < session.at ? "bg-primary" : index === session.at ? "bg-foreground" : "bg-border"}`} />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={card.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
          className="flex min-h-72 flex-col gap-5 rounded-2xl border bg-card p-6 sm:p-8"
        >
          <div className="flex flex-wrap gap-1.5">
            {/* The requirement in its own words: what this card is for, not its id. */}
            {card.requirement_ids.map((rid) => (
              <span key={rid} className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                {requirements.get(rid)?.text ?? rid}
              </span>
            ))}
            {card.requirement_ids.length === 0 && <span className="text-xs text-muted-foreground">About the company</span>}
          </div>
          <p className="font-display text-3xl leading-tight sm:text-4xl">{card.front}</p>
          {session.revealed ? (
            <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="flex flex-col gap-4 border-t pt-5">
              <p className="text-lg leading-relaxed">{card.back}</p>
            </m.div>
          ) : (
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
              <Button id="show-answer" size="lg" onClick={onReveal}>
                Show answer <kbd className="ml-1 rounded bg-primary-foreground/20 px-1.5 font-mono text-xs">Space</kbd>
              </Button>
              <Button variant="ghost" onClick={onSkip}>
                Skip <kbd className="ml-1 rounded bg-muted px-1.5 font-mono text-xs">S</kbd>
              </Button>
            </div>
          )}
        </m.div>
      </AnimatePresence>

      {session.revealed && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">How did that go?</p>
          <div role="group" aria-label="Rate your confidence" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map((r) => (
              <Button key={r.value} variant="outline" size="lg" className="h-auto flex-col gap-0.5 py-3" onClick={() => onRate(r.value)} title={r.hint}>
                <span className="flex items-center gap-2 font-semibold">
                  <kbd className="rounded bg-muted px-1.5 font-mono text-xs">{r.value}</kbd>
                  {r.label}
                </span>
                <span className="text-xs font-normal text-muted-foreground">{r.hint}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
