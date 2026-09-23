const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 minutes ago", "yesterday", "just now". Anything older than a week is a date, which is easier to place. */
export function formatRelative(date: Date | string, now: Date = new Date()): string {
  const then = new Date(date);
  const elapsed = now.getTime() - then.getTime();
  if (elapsed < 60_000) return "just now";
  if (elapsed > 7 * 86_400_000) return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(then);

  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const [unit, size] = UNITS.find(([, ms]) => elapsed >= ms)!;
  return relative.format(-Math.floor(elapsed / size), unit);
}

/**
 * The start of a text, cut at a word boundary, for a confirmation that names what it is about:
 * enough to recognise a question, not the whole of it.
 */
export function excerpt(text: string, max = 90): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).replace(/[,;:.]$/, "")}…`;
}
