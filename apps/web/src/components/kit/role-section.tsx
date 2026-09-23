import type { Kit, Requirement } from "@prepkit/core";
import { Badge } from "@/components/ui/badge";
import { numberRequirements } from "@/lib/requirements";

const sameWording = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

export function RoleSection({ kit }: { kit: Kit }) {
  const { role } = kit;
  const uncovered = new Set(kit.coverage.uncovered_requirement_ids);
  const numbers = numberRequirements(role.requirements);
  const questionsFor = (id: string) => kit.questions.filter((q) => q.requirement_ids.includes(id)).length;
  const groups: [string, string, Requirement[]][] = [
    ["Must have", "must", role.requirements.filter((r) => r.priority === "must")],
    ["Nice to have", "nice", role.requirements.filter((r) => r.priority === "nice")],
  ];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="role-heading" className="flex flex-col gap-3">
        <h2 id="role-heading" className="font-display text-2xl">
          {role.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {role.seniority && <span className="capitalize">{role.seniority}</span>}
          {role.seniority && kit.source.location && " · "}
          {kit.source.location}
        </p>
        {role.responsibilities.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {role.responsibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      {role.requirements.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-muted-foreground">
          The job description does not state any requirements, so none are listed. Nothing has been invented to fill the gap.
        </p>
      ) : (
        groups.map(
          ([heading, key, requirements]) =>
            requirements.length > 0 && (
              <section key={key} aria-labelledby={`requirements-${key}`} className="flex flex-col gap-3">
                <h2 id={`requirements-${key}`} className="font-display text-2xl">
                  {heading} <span className="font-sans text-sm text-muted-foreground">{requirements.length}</span>
                </h2>
                <ul className="flex flex-col gap-3">
                  {requirements.map((requirement) => {
                    const evidence = kit.requirement_evidence?.[requirement.id];
                    const count = questionsFor(requirement.id);
                    return (
                      <li key={requirement.id} className="flex gap-3 rounded-xl border bg-card p-4">
                        {/* The number questions and flashcards refer to it by. */}
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground">{numbers.get(requirement.id)?.number}</span>
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <p className="font-semibold">{requirement.text}</p>
                        {/* Every requirement is tied to the posting's own words. When they are the same
                            words, saying so is enough; the quote is shown when the wording differs,
                            which is when seeing the source matters. */}
                        {evidence &&
                          (sameWording(evidence, requirement.text) ? (
                            <p className="text-xs text-muted-foreground">Word for word from the posting</p>
                          ) : (
                            <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
                              <span className="sr-only">From the job description: </span>“{evidence}”
                            </blockquote>
                          ))}
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="border-transparent bg-muted capitalize text-muted-foreground">
                            {requirement.kind}
                          </Badge>
                          {uncovered.has(requirement.id) ? (
                            <Badge variant="secondary" className="border-transparent bg-warning text-warning-foreground">
                              No question covers this
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {count} {count === 1 ? "question" : "questions"}
                            </span>
                          )}
                        </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
        )
      )}
    </div>
  );
}
