import type { Response } from "supertest";
import { request } from "./support/http";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/cookies";
import { LOGIN_ATTEMPTS_PER_WINDOW, LOGIN_WINDOW_MS, createAuthRouter } from "../src/auth/routes";
import { SESSION_TTL_MS, createAuthService } from "../src/auth/service";
import { loadConfig } from "../src/config";
import { createMemorySessionRepository, createMemoryUserRepository } from "./support/memory-repositories";

const WEB = "http://localhost:3000";

/** A whole API over in-memory storage, with a clock the test owns. */
function setup(env: "test" | "production" = "test") {
  let time = new Date("2026-09-21T10:00:00Z").getTime();
  const config = loadConfig({ NODE_ENV: env, MONGODB_URI: "mongodb://unused-in-tests/prepkit", WEB_ORIGIN: WEB });
  const users = createMemoryUserRepository();
  const sessions = createMemorySessionRepository();
  const auth = createAuthService({ users, sessions, now: () => new Date(time) });
  const app = createApp({ config, routers: [createAuthRouter({ auth, config, now: () => time })], logError: () => {} });
  return { app, users, sessions, advance: (ms: number) => (time += ms) };
}

const ada = { email: "ada@example.com", password: "analytical-engine" };
const sessionCookie = (response: Response) =>
  (response.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";

describe("POST /api/auth/register", () => {
  it("creates the account, answers 201 with the user, and signs them in with a cookie", async () => {
    const { app } = setup();
    const response = await request(app).post("/api/auth/register").send(ada);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ user: { id: expect.any(String), email: "ada@example.com" } });
    expect(sessionCookie(response)).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
  });

  it("sets the cookie httpOnly and SameSite=Lax, expiring with the session", async () => {
    const cookie = sessionCookie(await request(setup().app).post("/api/auth/register").send(ada));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Expires=${new Date(Date.parse("2026-09-21T10:00:00Z") + SESSION_TTL_MS).toUTCString()}`);
    expect(cookie).not.toContain("Secure"); // plain http on localhost
  });

  it("marks the cookie Secure in production", async () => {
    const cookie = sessionCookie(await request(setup("production").app).post("/api/auth/register").send(ada));
    expect(cookie).toContain("Secure");
  });

  it("never puts the token or the password in a response body", async () => {
    const response = await request(setup().app).post("/api/auth/register").send(ada);
    const token = /=([^;]+);/.exec(sessionCookie(response))![1]!;
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toMatch(/analytical-engine|scrypt/);
  });

  it("lists every invalid field", async () => {
    const response = await request(setup().app).post("/api/auth/register").send({ email: "nope", password: "short" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details).toEqual([
      { path: "email", message: "Enter a valid email address" },
      { path: "password", message: "Use at least 8 characters" },
    ]);
  });

  it("answers 409 for an email that is already registered, whatever its capitalisation", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(ada);
    const response = await request(app).post("/api/auth/register").send({ ...ada, email: "ADA@Example.com" });
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({ code: "EMAIL_TAKEN", message: "An account with this email already exists" });
  });
});

describe("signing in, staying in, signing out", () => {
  it("runs the whole journey on one cookie jar", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(ada);
    const browser = request.agent(app);

    expect((await browser.get("/api/auth/me")).status).toBe(401);

    const login = await browser.post("/api/auth/login").send(ada);
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("ada@example.com");

    const me = await browser.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual(login.body);

    const logout = await browser.post("/api/auth/logout");
    expect(logout.status).toBe(204);
    expect(sessionCookie(logout)).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));

    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });

  it("answers a signed-out visitor with the 401 envelope", async () => {
    const response = await request(setup().app).get("/api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } });
  });

  it("gives the same 401 for a wrong password and for an unknown email", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(ada);

    const wrongPassword = await request(app).post("/api/auth/login").send({ ...ada, password: "difference-engine" });
    const unknownEmail = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: ada.password });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(sessionCookie(wrongPassword)).toBe("");
  });

  it.each([
    ["a made-up token", `${SESSION_COOKIE}=not-a-real-token`],
    ["an empty value", `${SESSION_COOKIE}=`],
    ["a badly encoded value", `${SESSION_COOKIE}=%E0%A4%A`],
    ["some other cookie", "theme=dark"],
  ])("treats %s as signed out", async (_name, cookie) => {
    const response = await request(setup().app).get("/api/auth/me").set("Cookie", cookie);
    expect(response.status).toBe(401);
  });

  it("finds the session cookie among others", async () => {
    const { app } = setup();
    const cookie = sessionCookie(await request(app).post("/api/auth/register").send(ada)).split(";")[0]!;
    const response = await request(app).get("/api/auth/me").set("Cookie", `theme=dark; ${cookie}; lang=en`);
    expect(response.status).toBe(200);
  });

  it("signs the user out when the session expires", async () => {
    const { app, advance } = setup();
    const cookie = sessionCookie(await request(app).post("/api/auth/register").send(ada)).split(";")[0]!;

    advance(SESSION_TTL_MS - 1);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    advance(1);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("lets logout succeed with no session at all, and still clears the cookie", async () => {
    const response = await request(setup().app).post("/api/auth/logout");
    expect(response.status).toBe(204);
    expect(sessionCookie(response)).toContain(`${SESSION_COOKIE}=;`);
  });

  it("signs out one device without touching another", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(ada);
    const laptop = request.agent(app);
    const phone = request.agent(app);
    await laptop.post("/api/auth/login").send(ada);
    await phone.post("/api/auth/login").send(ada);

    await laptop.post("/api/auth/logout");

    expect((await laptop.get("/api/auth/me")).status).toBe(401);
    expect((await phone.get("/api/auth/me")).status).toBe(200);
  });
});

describe("requests from another website", () => {
  it("refuses a state-changing request whose Origin is not the web app", async () => {
    const { app, users } = setup();
    const response = await request(app).post("/api/auth/register").set("Origin", "https://evil.example").send(ada);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "ORIGIN_NOT_ALLOWED", message: "This request did not come from the application" },
    });
    expect(users.all()).toHaveLength(0); // refused before it could act
  });

  it("accepts the web app's own origin, and requests with no Origin header", async () => {
    const { app } = setup();
    expect((await request(app).post("/api/auth/register").set("Origin", WEB).send(ada)).status).toBe(201);
    expect((await request(app).post("/api/auth/login").send(ada)).status).toBe(200);
  });

  it("does not block reads: a GET from anywhere is only ever answered with the caller's own data", async () => {
    const response = await request(setup().app).get("/api/health").set("Origin", "https://evil.example");
    expect(response.status).toBe(200);
  });
});

describe("too many attempts", () => {
  it("allows ten tries per email and address, then answers 429 with Retry-After", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(ada); // counts as the first attempt for this email
    const guess = () => request(app).post("/api/auth/login").send({ ...ada, password: "a-wrong-guess" });

    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW - 1; i++) expect((await guess()).status).toBe(401);

    const blocked = await guess();
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("900");
    expect(blocked.body.error).toEqual({
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many attempts. Please wait a few minutes and try again.",
      details: { retryAfterSeconds: 900 },
    });
  });

  it("blocks even the right password while the limit is in force, and lifts it afterwards", async () => {
    const { app, advance } = setup();
    await request(app).post("/api/auth/register").send(ada);
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; i++) await request(app).post("/api/auth/login").send({ ...ada, password: "wrong" });

    expect((await request(app).post("/api/auth/login").send(ada)).status).toBe(429);
    advance(LOGIN_WINDOW_MS);
    expect((await request(app).post("/api/auth/login").send(ada)).status).toBe(200);
  });

  it("counts each email separately, so one account's attacker does not lock out another user", async () => {
    const { app } = setup();
    const grace = { email: "grace@example.com", password: "compiler-pioneer" };
    await request(app).post("/api/auth/register").send(grace);
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW + 2; i++) await request(app).post("/api/auth/login").send({ ...ada, password: "wrong" });

    expect((await request(app).post("/api/auth/login").send(grace)).status).toBe(200);
  });
});
