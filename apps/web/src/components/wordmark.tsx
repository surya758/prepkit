import Link from "next/link";

export function Wordmark({ href = "/kits" }: { href?: string }) {
  return (
    <Link href={href} className="rounded-sm font-display text-2xl leading-none text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      Prep Kit
    </Link>
  );
}
