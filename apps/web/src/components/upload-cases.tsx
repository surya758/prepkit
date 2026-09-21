"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_ROLES_PER_FILE, parseCasesFile } from "@/lib/cases-file";
import { useCreateKits } from "@/lib/kits";
import type { BulkResult } from "@/lib/kits";

const LOOK: Record<BulkResult["status"], { label: string; className: string }> = {
  created: { label: "Created", className: "bg-success text-success-foreground" },
  duplicate: { label: "Already exists", className: "bg-muted text-muted-foreground" },
  invalid: { label: "Not created", className: "bg-destructive/15 text-destructive" },
};

const count = (results: BulkResult[], status: BulkResult["status"]) => results.filter((r) => r.status === status).length;

export function UploadCases() {
  const upload = useCreateKits();
  const input = useRef<HTMLInputElement>(null);
  // A file that cannot be used at all. A role that cannot be used is reported in its own row.
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setFileProblem(null);
    upload.reset();

    const parsed = parseCasesFile(await file.text());
    // Cleared so that choosing the same file again, after fixing it, is noticed.
    if (input.current) input.current.value = "";
    if (!parsed.ok) return setFileProblem(parsed.message);

    setLabels(parsed.cases.labels);
    upload.mutate(parsed.cases.items);
  }

  const results = upload.data?.results;
  const problem = fileProblem ?? (upload.error ? upload.error.message : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="cases-file">A JSON file of roles</Label>
        <Input
          ref={input}
          id="cases-file"
          type="file"
          accept="application/json,.json"
          disabled={upload.isPending}
          aria-describedby="cases-file-hint"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <p id="cases-file-hint" className="text-sm text-muted-foreground">
          Up to {MAX_ROLES_PER_FILE} roles, in the same format as the batch command: <code className="font-mono text-xs">[{"{"} &quot;id&quot;, &quot;jd&quot;, &quot;company_url&quot;, &quot;days&quot; {"}"}]</code>
        </p>
      </div>

      {upload.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Starting {labels.length} {labels.length === 1 ? "kit" : "kits"}
        </p>
      )}

      {problem && (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}

      {results && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-sm">
            {count(results, "created")} created · {count(results, "duplicate")} already existed · {count(results, "invalid")} not created
          </p>
          <ul className="flex flex-col gap-2">
            {results.map((result) => (
              <li key={result.index} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-sm">{labels[result.index] ?? `Row ${result.index + 1}`}</span>
                  <Badge variant="secondary" className={`border-transparent ${LOOK[result.status].className}`}>
                    {LOOK[result.status].label}
                  </Badge>
                </div>
                {result.status === "created" && <p className="text-sm text-muted-foreground">{result.kit.title}</p>}
                {result.status === "duplicate" && (
                  <p className="text-sm text-muted-foreground">
                    {result.message}.{" "}
                    {result.kitId && (
                      <Link href={`/kits/${result.kitId}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                        Open it
                      </Link>
                    )}
                  </p>
                )}
                {result.status === "invalid" && (
                  <ul className="text-sm text-destructive">
                    {(result.details?.length ? result.details.map((d) => `${d.path || "row"}: ${d.message}`) : [result.message]).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {count(results, "created") > 0 && (
            <Button asChild className="self-start">
              <Link href="/kits">Watch them generate</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
