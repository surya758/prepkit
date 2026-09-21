import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "../src/auth/schemas";
import { SESSION_TTL_MS, createAuthService } from "../src/auth/service";
import { createMemorySessionRepository, createMemoryUserRepository } from "./support/memory-repositories";

function setup() {
  let time = new Date("2026-09-21T10:00:00Z").getTime();
  const users = createMemoryUserRepository();
  const sessions = createMemorySessionRepository();
  const auth = createAuthService({ users, sessions, now: () => new Date(time) });
  return { auth, users, sessions, advance: (ms: number) => (time += ms) };
}

const ada = { email: "ada@example.com", password: "analytical-engine" };

describe("register", () => {
  it("creates the account and signs the user in", async () => {
    const { auth, users } = setup();
    const result = await auth.register(ada);

    expect(result.user).toEqual({ id: expect.any(String), email: "ada@example.com" });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(result.expiresAt).toEqual(new Date("2026-09-28T10:00:00Z"));
    expect(users.all()).toHaveLength(1);
  });

  it("stores a hash, never the password", async () => {
    const { auth, users } = setup();
    await auth.register(ada);
    expect(users.all()[0]!.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(users.all())).not.toContain("analytical-engine");
  });

  it("refuses an email that is already registered", async () => {
    const { auth, users } = setup();
    await auth.register(ada);
    await expect(auth.register({ ...ada, password: "a-different-password" })).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_TAKEN",
    });
    expect(users.all()).toHaveLength(1);
  });

  it("never returns the password hash to the caller", async () => {
    const { auth } = setup();
    const result = await auth.register(ada);
    expect(JSON.stringify(result)).not.toContain("scrypt");
  });
});

describe("login", () => {
  it("signs in with the right password and issues a new session each time", async () => {
    const { auth, sessions } = setup();
    const registered = await auth.register(ada);
    const first = await auth.login(ada);
    const second = await auth.login(ada);

    expect(first.user).toEqual(registered.user);
    expect(new Set([registered.token, first.token, second.token]).size).toBe(3);
    expect(sessions.all()).toHaveLength(3);
  });

  it("gives the same answer for a wrong password and for an unknown email", async () => {
    const { auth } = setup();
    await auth.register(ada);

    const wrongPassword = await auth.login({ ...ada, password: "difference-engine" }).catch((e) => e);
    const unknownEmail = await auth.login({ email: "nobody@example.com", password: "analytical-engine" }).catch((e) => e);

    expect(wrongPassword).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" });
    expect({ ...unknownEmail }).toEqual({ ...wrongPassword });
  });

  it("creates no session for a failed login", async () => {
    const { auth, sessions } = setup();
    await auth.register(ada);
    const before = sessions.all().length;
    await auth.login({ ...ada, password: "wrong-password" }).catch(() => undefined);
    expect(sessions.all()).toHaveLength(before);
  });
});

describe("sessions", () => {
  it("recognises the user from the token in their cookie", async () => {
    const { auth } = setup();
    const { token, user } = await auth.register(ada);
    expect(await auth.authenticate(token)).toEqual(user);
  });

  it("stores only a hash of the token, so a leaked database cannot be replayed as cookies", async () => {
    const { auth, sessions } = setup();
    const { token } = await auth.register(ada);

    const stored = sessions.all()[0]!;
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(token);
    expect(await auth.authenticate(stored.tokenHash)).toBeNull(); // the hash is not a valid token
  });

  it.each([undefined, "", "not-a-real-token"])("treats a missing or unknown token as signed out: %j", async (token) => {
    const { auth } = setup();
    await auth.register(ada);
    expect(await auth.authenticate(token)).toBeNull();
  });

  it("expires a session after seven days, and removes it", async () => {
    const { auth, sessions, advance } = setup();
    const { token } = await auth.register(ada);

    advance(SESSION_TTL_MS - 1);
    expect(await auth.authenticate(token)).not.toBeNull();

    advance(1);
    expect(await auth.authenticate(token)).toBeNull();
    expect(sessions.all()).toHaveLength(0);
  });

  it("logs out by deleting the session, so the old cookie stops working at once", async () => {
    const { auth } = setup();
    const { token } = await auth.register(ada);
    const other = await auth.login(ada);

    await auth.logout(token);

    expect(await auth.authenticate(token)).toBeNull();
    expect(await auth.authenticate(other.token)).not.toBeNull(); // other devices stay signed in
  });

  it("does nothing when logging out without a token", async () => {
    const { auth } = setup();
    await expect(auth.logout(undefined)).resolves.toBeUndefined();
  });
});

describe("input schemas", () => {
  it("lowercases and trims the email, so Ada@Example.com and ada@example.com are one account", () => {
    expect(registerSchema.parse({ email: "  Ada@Example.COM ", password: "long-enough" }).email).toBe("ada@example.com");
  });

  it.each([
    [{ email: "not-an-email", password: "long-enough" }, "email"],
    [{ email: "ada@example.com", password: "short" }, "password"],
    [{ email: "ada@example.com", password: "x".repeat(201) }, "password"],
    [{ email: "ada@example.com" }, "password"],
  ])("rejects an invalid registration: %j", (input, field) => {
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual([field]);
  });

  it("does not apply the length rule at login: a wrong password is just a wrong password", () => {
    expect(loginSchema.safeParse({ email: "ada@example.com", password: "short" }).success).toBe(true);
  });
});
