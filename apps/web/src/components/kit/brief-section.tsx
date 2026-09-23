"use client";

import type { Kit, KitMeta } from "@prepkit/core";
import { LoaderCircle, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBriefEdits } from "@/features/brief";
import { useRegenerate } from "@/features/regenerate";
import { formatRelative } from "@/lib/format";
import { isKept, metaFor } from "@/lib/item-meta";
import type { BriefField } from "@/lib/kit-edits";
import { BriefFieldEditor } from "./brief-editor";
import { ItemBadges } from "./item-badges";

const FIELDS: { field: BriefField; label: string }[] = [
  { field: "summary", label: "Summary" },
  { field: "what_they_do", label: "What they do" },
];

const host = (url: string) => {
  try {
    return new URL(url).host + new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
};

function SourceLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="break-all font-mono text-xs text-primary underline-offset-4 hover:underline">
      {host(url)}
    </a>
  );
}

export function BriefSection({ kitId, kit, meta }: { kitId: string; kit: Kit; meta: KitMeta | null }) {
  const brief = kit.company_brief;
  const hiring = kit.hiring_process;
  const discussion = kit.public_discussion;
  const edits = useBriefEdits(kitId);
  const regen = useRegenerate(kitId);
  const target = { section: "brief" } as const;
  const running = regen.isRunning(target);
  const refusal = regen.refusal(target);
  // Which field's editor is open. The only state this view owns.
  const [editing, setEditing] = useState<{ field: BriefField; wasUntouched: boolean } | null>(null);
  // A brief is only ever written from pages that were read, so no sources means no research.
  // The pipeline then fills the brief with its own plain statement of that, which is shown as
  // it is: there is one wording of "we could not find out", and it is the pipeline's.
  const researched = brief.sources.length > 0;
  const kept = FIELDS.filter(({ field }) => isKept(metaFor(meta, `brief.${field}`))).length;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="brief-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="brief-heading" className="font-display text-2xl">
            {kit.source.company || "The company"}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => regen.regenerate(target)} disabled={running} aria-describedby="regen-note-brief">
            {running ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {running ? "Regenerating" : "Regenerate"}
          </Button>
        </div>
        {/* What a regeneration will do, said before it is pressed: the rule the badges show, in a sentence. */}
        <p id="regen-note-brief" role={running ? "status" : undefined} className="text-sm text-muted-foreground">
          {running
            ? `Reading the company's site again and rewriting the brief. ${kept === 0 ? "" : kept === FIELDS.length ? "Both fields are yours and stay as they are. " : "The field you rewrote stays as it is. "}You can keep editing meanwhile.`
            : kept === 0
              ? "Regenerate reads the company's site again and rewrites both fields. Edit a field to keep your wording."
              : kept === FIELDS.length
                ? "Both fields are yours, so Regenerate would keep them and change nothing."
                : "Regenerate rewrites the generated field and keeps the one you rewrote."}
        </p>
        {refusal && (
          <p role="alert" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            {refusal}
          </p>
        )}
        <div className={researched ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-xl border border-dashed p-5"}>
          {FIELDS.map(({ field, label }) => {
            const value = brief[field];
            if (editing?.field === field) {
              return (
                <BriefFieldEditor
                  key={field}
                  id={`brief-${field}`}
                  label={label}
                  value={value}
                  saving={edits.isPending}
                  onSave={(next) => edits.edit(field, next)}
                  onUndo={(next) => edits.undo(field, next, editing.wasUntouched)}
                  onClose={() => setEditing(null)}
                />
              );
            }
            // An empty description is not shown as a blank; it is a place to write one.
            return (
              <div key={field} className="group flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">{label}</span>
                  <ItemBadges item={metaFor(meta, `brief.${field}`)} />
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing({ field, wasUntouched: !metaFor(meta, `brief.${field}`).edited })} aria-label={`Edit the ${label.toLowerCase()}`}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                </div>
                {value ? (
                  <p className={field === "summary" && researched ? "text-lg leading-relaxed" : "leading-relaxed text-muted-foreground"}>{value}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Nothing written yet.</p>
                )}
              </div>
            );
          })}
        </div>
        {brief.sources.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-muted-foreground">Written from</h3>
            <ul className="flex flex-col gap-1">
              {brief.sources.map((url) => (
                <li key={url}>
                  <SourceLink url={url} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="hiring-heading" className="flex flex-col gap-3">
        <h2 id="hiring-heading" className="font-display text-2xl">
          How they hire
        </h2>
        {hiring?.found && hiring.stages.length > 0 ? (
          <>
            <ol className="flex flex-col gap-3">
              {hiring.stages.map((stage, index) => (
                <li key={`${index}-${stage.name}`} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground">{index + 1}</span>
                  <div className="flex flex-col">
                    <span className="font-semibold">{stage.name}</span>
                    {stage.description && <span className="text-sm text-muted-foreground">{stage.description}</span>}
                  </div>
                </li>
              ))}
            </ol>
            {hiring.source && (
              <p className="text-sm text-muted-foreground">
                As the company describes it, at <SourceLink url={hiring.source} />
              </p>
            )}
          </>
        ) : (
          <p className="rounded-xl border border-dashed p-5 text-muted-foreground">
            {hiring?.source ? "A hiring page was found, but it does not describe the interview stages." : "No page describing their interview process was found on the company's site."} Nothing has been guessed in its place.
          </p>
        )}
      </section>

      <section aria-labelledby="discussion-heading" className="flex flex-col gap-3">
        <h2 id="discussion-heading" className="font-display text-2xl">
          What people say publicly
        </h2>
        {discussion && discussion.hits.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">Unverified public posts from {discussion.source}, newest first. Treat them as hearsay, not as the company&apos;s word.</p>
            <ul className="flex flex-col gap-3">
              {discussion.hits.map((hit) => (
                <li key={hit.url} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
                  <a href={hit.url} target="_blank" rel="noreferrer noopener" className="font-semibold underline-offset-4 hover:underline">
                    {hit.title}
                  </a>
                  <p className="text-sm text-muted-foreground">{hit.excerpt}</p>
                  <p className="text-xs text-muted-foreground">{formatRelative(hit.posted_at)}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="rounded-xl border border-dashed p-5 text-muted-foreground">
            {discussion?.searched ? `No recent public discussion of their interviews was found on ${discussion.source}.` : "Public discussion was not searched, because the company could not be identified."}
          </p>
        )}
      </section>
    </div>
  );
}
