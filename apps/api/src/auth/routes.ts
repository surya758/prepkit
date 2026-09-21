import { Router } from "express";
import type { Config } from "../config";
import { createRateLimit } from "../middleware/rate-limit";
import { createRequireUser, currentUser } from "../middleware/require-user";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookies";
import { loginSchema, registerSchema } from "./schemas";
import type { AuthService } from "./service";

// HTTP for signing in, and nothing more: parse the body, call the service, set or clear the
// cookie. The token is only ever sent as an httpOnly cookie, never in a response body.

export const LOGIN_ATTEMPTS_PER_WINDOW = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface AuthRouterDependencies {
  auth: AuthService;
  config: Config;
  now?: () => number;
}

export function createAuthRouter({ auth, config, now }: AuthRouterDependencies): Router {
  const router = Router();
  const requireUser = createRequireUser(auth);

  // Makes password guessing slow. Counted per address AND email: counting by address alone
  // would let one person's typos lock out everyone behind the same office network.
  // Registration shares the limiter, since it also reveals whether an email is registered.
  const limitAttempts = createRateLimit({
    windowMs: LOGIN_WINDOW_MS,
    max: LOGIN_ATTEMPTS_PER_WINDOW,
    key: (req) => `${req.ip}|${String((req.body as { email?: unknown } | undefined)?.email ?? "").toLowerCase().trim()}`,
    code: "TOO_MANY_ATTEMPTS",
    message: "Too many attempts. Please wait a few minutes and try again.",
    now,
  });

  router.post("/auth/register", limitAttempts, async (req, res) => {
    const signedIn = await auth.register(registerSchema.parse(req.body));
    setSessionCookie(res, signedIn.token, signedIn.expiresAt, config);
    res.status(201).json({ user: signedIn.user });
  });

  router.post("/auth/login", limitAttempts, async (req, res) => {
    const signedIn = await auth.login(loginSchema.parse(req.body));
    setSessionCookie(res, signedIn.token, signedIn.expiresAt, config);
    res.json({ user: signedIn.user });
  });

  // Always succeeds and always clears the cookie: signing out of an expired session is not an error.
  router.post("/auth/logout", async (req, res) => {
    await auth.logout(readSessionToken(req));
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.get("/auth/me", requireUser, (req, res) => {
    res.json({ user: currentUser(req) });
  });

  return router;
}
