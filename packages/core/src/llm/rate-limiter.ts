// Free tiers limit requests per minute AND tokens per minute, and the brief calls a pipeline
// that falls over on "slow down" the most common way to lose points. So every model call
// waits here first, and the limiter — not luck — keeps a batch inside both limits.

const WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  requestsPerMinute: number;
  tokensPerMinute: number;
  /**
   * Smallest gap between two calls. Defaults to half the average gap. Set it explicitly for
   * a provider that limits per second: "1 request per second" needs a gap of just over
   * 1000 ms, which "60 per minute" alone would not give.
   */
  minGapMs?: number;
  /** Injected in tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Reservation {
  /** Replace the estimate with what the provider actually counted. */
  settle(actualTokens: number): void;
}

export interface RateLimiter {
  /** Resolves when the call may be made. Callers are served in the order they asked. */
  acquire(estimatedTokens: number): Promise<Reservation>;
  /** The provider said to back off (429 / Retry-After): nobody proceeds until then. */
  pause(ms: number): void;
}

/** Roughly four characters per token for English text; good enough to budget with. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

interface Entry {
  at: number;
  tokens: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { requestsPerMinute, tokensPerMinute } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // A sliding one-minute window would still allow the whole minute's quota in one burst,
  // which some providers reject. Spacing calls out by half the average gap avoids that.
  const minGapMs = options.minGapMs ?? Math.floor(WINDOW_MS / requestsPerMinute / 2);

  let entries: Entry[] = [];
  let pausedUntil = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  let tail: Promise<unknown> = Promise.resolve();

  /** How long until this call fits, or 0 if it fits now. */
  function waitFor(tokens: number): number {
    const t = now();
    entries = entries.filter((e) => t - e.at < WINDOW_MS);

    if (t < pausedUntil) return pausedUntil - t;
    if (t - lastAt < minGapMs) return minGapMs - (t - lastAt);

    if (entries.length >= requestsPerMinute) return entries[0]!.at + WINDOW_MS - t;

    // A single call bigger than the whole per-minute budget can never "fit"; let it through
    // on an empty window rather than wait forever, and let the provider be the judge.
    const used = entries.reduce((sum, e) => sum + e.tokens, 0);
    if (entries.length > 0 && used + tokens > tokensPerMinute) {
      // Wait until enough of the oldest entries have aged out to make room.
      let freed = 0;
      for (const entry of entries) {
        freed += entry.tokens;
        if (used - freed + tokens <= tokensPerMinute) return entry.at + WINDOW_MS - t;
      }
      return entries.at(-1)!.at + WINDOW_MS - t;
    }
    return 0;
  }

  async function reserve(tokens: number): Promise<Reservation> {
    for (let wait = waitFor(tokens); wait > 0; wait = waitFor(tokens)) {
      await sleep(wait);
    }
    const entry: Entry = { at: now(), tokens };
    entries.push(entry);
    lastAt = entry.at;
    return {
      settle(actualTokens) {
        entry.tokens = actualTokens;
      },
    };
  }

  return {
    acquire(estimatedTokens) {
      // Chained so concurrent callers queue first-come-first-served instead of racing.
      const turn = tail.then(() => reserve(estimatedTokens));
      tail = turn.catch(() => {});
      return turn;
    },
    pause(ms) {
      pausedUntil = Math.max(pausedUntil, now() + ms);
    },
  };
}
