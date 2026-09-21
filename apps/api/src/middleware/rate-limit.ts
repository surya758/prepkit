import type { Request, RequestHandler } from "express";
import { AppError } from "../errors";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** What is being limited: an address, an address plus an email, and so on. */
  key: (req: Request) => string;
  code?: string;
  message?: string;
  now?: () => number;
}

/**
 * A fixed-window counter in memory. It exists to make password guessing slow, and one process
 * on a free host is all there is to coordinate. With several instances each would count on its
 * own; that would need a shared store, and is noted in the README rather than built.
 */
export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, key, now = Date.now } = options;
  const windows = new Map<string, { startedAt: number; count: number }>();

  return (req, res, next) => {
    const time = now();
    // Forget finished windows as we go, so the map cannot grow without bound.
    if (windows.size > 5_000) {
      for (const [k, w] of windows) if (time - w.startedAt >= windowMs) windows.delete(k);
    }

    const id = key(req);
    let window = windows.get(id);
    if (!window || time - window.startedAt >= windowMs) {
      window = { startedAt: time, count: 0 };
      windows.set(id, window);
    }
    window.count += 1;

    if (window.count > max) {
      const retryAfterSeconds = Math.ceil((window.startedAt + windowMs - time) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return next(
        new AppError(429, options.code ?? "TOO_MANY_REQUESTS", options.message ?? "Too many requests. Please try again later.", {
          retryAfterSeconds,
        }),
      );
    }
    next();
  };
}
