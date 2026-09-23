import type { PracticeProgress, Requirement, RequirementPracticeStatus } from "@prepkit/core";

// What has been covered and what has not, by requirement: "I have done 9 of 15 cards" says
// less than "I have not touched anything on system design". The statuses are the API's.

const STATUS: Record<RequirementPracticeStatus, { label: string; className: string }> = {
  weak: { label: "Weak", className: "bg-destructive/15 text-destructive" },
  not_started: { label: "Not started", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "In progress", className: "bg-accent text-accent-foreground" },
  confident: { label: "Confident", className: "bg-success text-success-foreground" },
  no_cards: { label: "No cards", className: "border text-muted-foreground" },
};

interface Props {
  progress: PracticeProgress;
  requirements: Requirement[];
}

export function CoveragePanel({ progress, requirements }: Props) {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const weak = progress.requirements.filter((r) => r.status === "weak").length;
  const untouched = progress.requirements.filter((r) => r.status === "not_started").length;

  return (
    // Beside the card on a laptop it stays in view and scrolls on its own, so a kit with many
    // requirements does not make the page a long scroll; on a phone it stacks below the card.
    <aside aria-labelledby="coverage-heading" className="flex flex-col gap-3 rounded-2xl border bg-card p-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
      <h2 id="coverage-heading" className="font-display text-2xl">
        What you have covered
      </h2>
      <p className="text-sm text-muted-foreground">
        {progress.practised} of {progress.total} cards practised · {progress.confident} known
        {weak > 0 && ` · ${weak} ${weak === 1 ? "requirement is" : "requirements are"} weak`}
        {untouched > 0 && ` · ${untouched} not started`}
      </p>
      {progress.requirements.length === 0 ? (
        <p className="text-sm text-muted-foreground">This kit has no requirements to track.</p>
      ) : (
        <ul className="flex flex-col">
          {progress.requirements.map((r) => {
            const look = STATUS[r.status];
            return (
              <li key={r.requirement_id} className="flex items-start gap-3 border-t py-2.5 first:border-t-0">
                <span className="min-w-0 flex-1 text-sm">
                  {byId.get(r.requirement_id)?.text ?? r.requirement_id}
                  {r.card_ids.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {r.practised} of {r.card_ids.length} {r.card_ids.length === 1 ? "card" : "cards"}
                    </span>
                  )}
                </span>
                <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold ${look.className}`}>{look.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">The next sitting starts with the cards you have not seen, then the ones you rated lowest.</p>
    </aside>
  );
}
