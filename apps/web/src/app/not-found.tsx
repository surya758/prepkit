import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

// Also what someone sees for a kit id that is mistyped or not theirs to open, so it says where
// to go next rather than only what went wrong.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="font-display text-4xl">This page does not exist</h1>
      <p className="max-w-md text-muted-foreground">The address may be mistyped, or the page may have been removed.</p>
      <Button asChild size="lg">
        <Link href="/kits">Go to your kits</Link>
      </Button>
    </main>
  );
}
