import type { RequestHandler } from "express";
import { readSessionToken } from "../auth/cookies";
import type { AuthService, PublicUser } from "../auth/service";
import { unauthorized } from "../errors";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by requireUser. Routes mounted behind it can rely on it being there. */
    user?: PublicUser;
  }
}

/**
 * Guards a router: a request without a valid session never reaches the routes behind it. A
 * missing cookie, an unknown token and an expired session all get the same 401, which the
 * interface answers by sending the user to sign in.
 */
export function createRequireUser(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const user = await auth.authenticate(readSessionToken(req));
    if (!user) throw unauthorized();
    req.user = user;
    next();
  };
}

/** For routes behind requireUser, where a missing user would be a wiring mistake, not a 401. */
export function currentUser(req: { user?: PublicUser }): PublicUser {
  if (!req.user) throw new Error("currentUser() was called on a route that is not behind requireUser");
  return req.user;
}
