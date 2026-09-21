"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { safeNext, useMe, useSignIn } from "@/lib/auth";

const COPY = {
  login: { title: "Welcome back", submit: "Sign in", pending: "Signing in", other: "New here?", otherLink: "Create an account", otherHref: "/register" },
  register: { title: "Create your account", submit: "Create account", pending: "Creating account", other: "Already have an account?", otherLink: "Sign in", otherHref: "/login" },
} as const;

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const copy = COPY[mode];
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const me = useMe();
  const signIn = useSignIn(mode);

  // Already signed in — or just became so — means there is nothing to do on this page.
  useEffect(() => {
    if (me.data) router.replace(next);
  }, [me.data, next, router]);

  const error = signIn.error instanceof ApiError ? signIn.error : null;
  const fields = error?.fields ?? {};
  // A problem with a particular field is shown at that field. Anything else is shown once, above the button.
  const formMessage = signIn.error && Object.keys(fields).length === 0 ? signIn.error.message : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    signIn.mutate(
      { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") },
      {
        onError: (failure) => {
          const first = failure instanceof ApiError ? Object.keys(failure.fields)[0] : undefined;
          document.getElementById(first ?? "email")?.focus();
        },
      },
    );
  }

  const otherHref = params.get("next") ? `${copy.otherHref}?next=${encodeURIComponent(next)}` : copy.otherHref;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <h1 className="font-display text-4xl leading-tight">{copy.title}</h1>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" autoFocus required aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? "email-error" : undefined} />
        {fields.email && (
          <p id="email-error" className="text-sm text-destructive">
            {fields.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          aria-invalid={Boolean(fields.password)}
          aria-describedby={fields.password ? "password-error" : mode === "register" ? "password-hint" : undefined}
        />
        {fields.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {fields.password}
          </p>
        ) : (
          mode === "register" && (
            <p id="password-hint" className="text-sm text-muted-foreground">
              At least 8 characters.
            </p>
          )
        )}
      </div>

      {formMessage && (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {formMessage}
        </p>
      )}

      <Button type="submit" size="lg" disabled={signIn.isPending}>
        {signIn.isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {signIn.isPending ? copy.pending : copy.submit}
      </Button>

      <p className="text-sm text-muted-foreground">
        {copy.other}{" "}
        <Link href={otherHref} className="font-semibold text-primary underline-offset-4 hover:underline">
          {copy.otherLink}
        </Link>
      </p>
    </form>
  );
}
