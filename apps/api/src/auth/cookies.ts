import type { Request, Response } from "express";
import type { Config } from "../config";

// The session cookie. httpOnly keeps it away from scripts, so an XSS bug cannot read it.
// SameSite=Lax keeps it off cross-site POSTs, which is the first half of CSRF protection
// (middleware/same-origin.ts is the second). Secure is on wherever the site is served over
// HTTPS, which in practice means production.

export const SESSION_COOKIE = "prepkit_session";

/** Reads one cookie from the header. A parser dependency for one cookie is not worth having. */
export function readSessionToken(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const baseOptions = (config: Config) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.isProduction,
  path: "/",
});

export function setSessionCookie(res: Response, token: string, expiresAt: Date, config: Config): void {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(config), expires: expiresAt });
}

export function clearSessionCookie(res: Response, config: Config): void {
  // A cookie is only cleared by one with the same attributes.
  res.clearCookie(SESSION_COOKIE, baseOptions(config));
}
