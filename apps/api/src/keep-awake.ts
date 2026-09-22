// Free hosting spins an instance down after fifteen minutes without an inbound request and takes
// up to a minute to bring it back. While this process runs it asks for its own health check
// through its public address, which goes out and comes back in through the host's edge and so
// counts as traffic: the instance never idles. The interval is well inside the fifteen minutes;
// a failed request is nothing to act on, the next one comes anyway.

export const KEEP_AWAKE_INTERVAL_MS = 10 * 60 * 1000;

export interface KeepAwakeOptions {
  intervalMs?: number;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/** Starts the periodic self-request and returns the function that stops it. */
export function startKeepAwake(publicUrl: string, { intervalMs = KEEP_AWAKE_INTERVAL_MS, fetch: request = fetch, log = console.log }: KeepAwakeOptions = {}): () => void {
  const target = new URL("/api/health", publicUrl).toString();
  const ping = () => {
    request(target, { signal: AbortSignal.timeout(30_000) }).catch(() => {});
  };
  const timer = setInterval(ping, intervalMs);
  // The timer must not keep the process alive on its own; shutdown is decided elsewhere.
  timer.unref();
  log(`[api] keeping the instance awake: ${target} every ${Math.round(intervalMs / 60_000)} min`);
  return () => clearInterval(timer);
}
