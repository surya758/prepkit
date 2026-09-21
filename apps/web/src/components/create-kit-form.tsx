"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { useCreateKit } from "@/lib/kits";
import type { CreateKitInput } from "@/lib/kits";

const FIELDS = ["jd", "companyUrl", "days"] as const;

function read(form: HTMLFormElement): CreateKitInput {
  const data = new FormData(form);
  const days = String(data.get("days") ?? "").trim();
  // An empty box is sent as "no number", so the API answers with its own sentence about days.
  return { jd: String(data.get("jd") ?? ""), companyUrl: String(data.get("companyUrl") ?? ""), days: days === "" ? undefined : Number(days) };
}

export function CreateKitForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const create = useCreateKit();
  // Made when the "already exists" choice is shown, and reused for every press from it.
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const error = create.error instanceof ApiError ? create.error : null;
  const fields = error?.fields ?? {};
  const existing = error?.code === "KIT_ALREADY_EXISTS" ? (error.details as { kitId?: string } | undefined) : undefined;
  const formMessage = create.error && !existing && Object.keys(fields).length === 0 ? create.error.message : null;

  // A second press while the first is on its way is dropped here, not just by the disabled
  // button, which only takes effect on the next render. It matters because when mutate() is
  // called twice, only the last call's callbacks run: the first press would create the kit and
  // the second would report "already exists", leaving the user on this page believing it failed.
  const inFlight = useRef(false);

  function submit(input: CreateKitInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    create.mutate(input, {
      onSettled: () => {
        inFlight.current = false;
      },
      // Back to the list, where the new kit shows as generating and updates by itself.
      onSuccess: () => router.push("/kits"),
      onError: (failure) => {
        if (!(failure instanceof ApiError)) return;
        if (failure.code === "KIT_ALREADY_EXISTS") return setFreshKey(crypto.randomUUID());
        const first = FIELDS.find((name) => failure.fields[name]);
        if (first) document.getElementById(first)?.focus();
      },
    });
  }

  return (
    <form
      ref={form}
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit(read(event.currentTarget));
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="jd">Job description</Label>
        <Textarea id="jd" name="jd" rows={12} autoFocus required className="max-h-[60vh] min-h-48" aria-invalid={Boolean(fields.jd)} aria-describedby={fields.jd ? "jd-error" : "jd-hint"} />
        {fields.jd ? (
          <p id="jd-error" className="text-sm text-destructive">
            {fields.jd}
          </p>
        ) : (
          <p id="jd-hint" className="text-sm text-muted-foreground">
            Paste the whole posting. Requirements are taken from its wording, never invented.
          </p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyUrl">Company website</Label>
          <Input id="companyUrl" name="companyUrl" type="url" inputMode="url" autoComplete="off" placeholder="https://" aria-invalid={Boolean(fields.companyUrl)} aria-describedby={fields.companyUrl ? "companyUrl-error" : "companyUrl-hint"} />
          {fields.companyUrl ? (
            <p id="companyUrl-error" className="text-sm text-destructive">
              {fields.companyUrl}
            </p>
          ) : (
            <p id="companyUrl-hint" className="text-sm text-muted-foreground">
              Optional. Read to find out what they do and how they hire.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="days">Days until the interview</Label>
          <Input id="days" name="days" type="number" inputMode="numeric" min={1} max={365} defaultValue={7} required aria-invalid={Boolean(fields.days)} aria-describedby={fields.days ? "days-error" : undefined} />
          {fields.days && (
            <p id="days-error" className="text-sm text-destructive">
              {fields.days}
            </p>
          )}
        </div>
      </div>

      {existing && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <p className="font-semibold">You already have a kit for this job description and company</p>
          <p className="text-sm text-muted-foreground">Open it to keep your edits and practice, or generate a separate fresh one. A different number of days does not need a new kit: the schedule can be re-planned inside it.</p>
          <div className="flex flex-wrap gap-2">
            {existing.kitId && (
              <Button asChild>
                <Link href={`/kits/${existing.kitId}`}>Open the existing kit</Link>
              </Button>
            )}
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => form.current && freshKey && submit({ ...read(form.current), fresh: { idempotencyKey: freshKey } })}>
              Generate a fresh one anyway
            </Button>
          </div>
        </div>
      )}

      {formMessage && (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {formMessage}
        </p>
      )}

      {!existing && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={create.isPending}>
            {create.isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {create.isPending ? "Starting" : "Generate kit"}
          </Button>
          <p className="text-sm text-muted-foreground">Takes about half a minute. You can leave the page while it runs.</p>
        </div>
      )}
    </form>
  );
}
