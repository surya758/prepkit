import type { Kit } from "@prepkit/core";
import { formatRelative } from "@/lib/format";

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

export function BriefSection({ kit }: { kit: Kit }) {
  const brief = kit.company_brief;
  const hiring = kit.hiring_process;
  const discussion = kit.public_discussion;
  // A brief is only ever written from pages that were read, so no sources means no research.
  // The pipeline then fills the brief with its own plain statement of that, which is shown as
  // it is: there is one wording of "we could not find out", and it is the pipeline's.
  const researched = brief.sources.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="brief-heading" className="flex flex-col gap-3">
        <h2 id="brief-heading" className="font-display text-2xl">
          {kit.source.company || "The company"}
        </h2>
        {researched ? (
          <>
            <p className="text-lg leading-relaxed">{brief.summary}</p>
            {brief.what_they_do && <p className="leading-relaxed text-muted-foreground">{brief.what_they_do}</p>}
          </>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed p-5 text-muted-foreground">
            <p>{brief.summary}</p>
            {brief.what_they_do && <p>{brief.what_they_do}</p>}
          </div>
        )}
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
