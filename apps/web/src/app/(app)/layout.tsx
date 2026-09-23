"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark } from "@/components/wordmark";
import { signedOutOnPurpose, useMe, useSignOut } from "@/lib/auth";

// Everything under (app) needs a signed-in user. This is the one place that decides so: pages
// inside never check, and a session that ends mid-visit lands here too (see providers.tsx).
// The API is what actually protects the data; this only decides what to show.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const signOut = useSignOut();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (me.data === null) router.replace(signedOutOnPurpose() ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [me.data, pathname, router]);

  if (me.isError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-display text-3xl">We could not check who you are</h1>
        <p className="max-w-md text-muted-foreground">{me.error.message}</p>
        <Button onClick={() => me.refetch()}>Try again</Button>
      </main>
    );
  }

  // The page renders at once, with its own loading state, while the user is checked: a signed-out
  // visitor's page request answers 401, which marks them signed out (providers.tsx) and lands here
  // as me.data === null. Waiting for the check first would mean two skeletons and an extra round trip.
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-8">
        <Wordmark />
        <div className="flex items-center gap-1 sm:gap-3">
          {me.data ? (
            <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:inline">{me.data.email}</span>
          ) : (
            <Skeleton className="hidden h-4 w-40 sm:block" />
          )}
          <ThemeToggle />
          {me.data ? (
            <Button variant="outline" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          ) : (
            <Skeleton className="h-8 w-20" />
          )}
        </div>
      </header>
      {me.data !== null ? (
        children
      ) : (
        // Nobody is signed in and the redirect to sign-in is on its way: the frame stays, the
        // page is empty. A list-shaped placeholder here would read as a page that never came.
        <main aria-busy="true" aria-label="Going to the sign-in page" className="flex-1" />
      )}
    </div>
  );
}
