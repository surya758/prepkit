import { createHash, randomBytes } from "node:crypto";
import { AppError, conflict } from "../errors";
import { hashPassword, verifyPassword } from "./passwords";
import type { SessionRepository, User, UserRepository } from "./repository";
import type { LoginInput, RegisterInput } from "./schemas";

// The rules of signing in. No HTTP in here: routes turn a request into a call and a result
// into a cookie.
//
// Sessions are server-side. The cookie holds a random token; the database holds only its
// SHA-256, so a leaked database cannot be replayed as cookies. Logging out deletes the row,
// which a stateless token could not do.

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export interface PublicUser {
  id: string;
  email: string;
}

export interface SignedIn {
  user: PublicUser;
  /** Goes into the cookie, and nowhere else. */
  token: string;
  expiresAt: Date;
}

export interface AuthServiceDependencies {
  users: UserRepository;
  sessions: SessionRepository;
  now?: () => Date;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const toPublic = (user: User): PublicUser => ({ id: user.id, email: user.email });

// Checked when the email is unknown, so that "no such user" takes as long as "wrong password"
// and the response time does not reveal which emails are registered.
const DUMMY_HASH = hashPassword("a password nobody has");

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService({ users, sessions, now = () => new Date() }: AuthServiceDependencies) {
  async function startSession(user: User): Promise<SignedIn> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
    await sessions.create({ tokenHash: hashToken(token), userId: user.id, expiresAt });
    return { user: toPublic(user), token, expiresAt };
  }

  return {
    async register(input: RegisterInput): Promise<SignedIn> {
      const user = await users.create({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        createdAt: now(),
      });
      if (!user) throw conflict("EMAIL_TAKEN", "An account with this email already exists");
      return startSession(user);
    },

    async login(input: LoginInput): Promise<SignedIn> {
      const user = await users.findByEmail(input.email);
      const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
      // One message for both cases: which of the two was wrong is not the caller's business.
      if (!user || !passwordMatches) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
      }
      return startSession(user);
    },

    async logout(token: string | undefined): Promise<void> {
      if (token) await sessions.delete(hashToken(token));
    },

    /** The signed-in user for a cookie token, or null for a missing, unknown or expired one. */
    async authenticate(token: string | undefined): Promise<PublicUser | null> {
      if (!token) return null;
      const tokenHash = hashToken(token);
      const session = await sessions.findByTokenHash(tokenHash);
      if (!session) return null;
      if (session.expiresAt.getTime() <= now().getTime()) {
        await sessions.delete(tokenHash);
        return null;
      }
      const user = await users.findById(session.userId);
      return user ? toPublic(user) : null;
    },
  };
}
