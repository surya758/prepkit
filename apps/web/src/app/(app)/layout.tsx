"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { useMe, useSignOut } from "@/lib/auth";

// Everything under (app) needs a signed-in user. This is the one place that decides so: pages
// inside never check, and a session that ends mid-visit lands here too (see providers.tsx).
// The API is what actually protects the data; this only decides what to show.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const signOut = useSignOut();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (me.data === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
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

  if (!me.data) {
    return (
      <main className="flex flex-1 items-center justify-center" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-8">
        <Wordmark />
        <div className="flex items-center gap-1 sm:gap-3">
          <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:inline">{me.data.email}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}
