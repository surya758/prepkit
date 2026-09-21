import type { RequestHandler } from "express";
import { AppError } from "../errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The second half of CSRF protection. Browsers attach an Origin header to every state-changing
 * request and a page cannot forge it, so a POST whose Origin is some other website is refused
 * before it can act with the user's cookie. Requests with no Origin header are not from a
 * browser page (curl, the batch tooling, server-to-server) and carry no ambient cookie to abuse.
 */
export function createSameOriginGuard(allowedOrigin: string): RequestHandler {
  const allowed = new URL(allowedOrigin).origin;
  return (req, _res, next) => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || origin === undefined || origin === allowed) return next();
    next(new AppError(403, "ORIGIN_NOT_ALLOWED", "This request did not come from the application"));
  };
}
