import { PipelineError } from "@prepkit/core";
import type { ProgressEvent } from "@prepkit/core";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuthRouter } from "../src/auth/routes";
import { createAuthService } from "../src/auth/service";
import { loadConfig } from "../src/config";
import { createJobRunner } from "../src/kits/job-runner";
import type { GenerateFn } from "../src/kits/job-runner";
import { KITS_PER_HOUR, createKitRouter } from "../src/kits/routes";
import { createKitService } from "../src/kits/service";
import { createRequireUser } from "../src/middleware/require-user";
import { createMemoryKitRepository, createMemorySessionRepository, createMemoryUserRepository } from "./support/memory-repositories";
import { sampleKit } from "./support/sample-kit";

const step = (name: string, status: ProgressEvent["status"]): ProgressEvent => ({ step: name, status, at: "2026-09-21T10:00:00.000Z" });

/** The whole API over in-memory storage, with a stand-in for the pipeline. */
function setup(generate: GenerateFn = async () => sampleKit()) {
  const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: "mongodb://unused-in-tests/prepkit" });
  const auth = createAuthService({ users: createMemoryUserRepository(), sessions: createMemorySessionRepository() });
  const kitRepository = createMemoryKitRepository();
  const runner = createJobRunner({ kits: kitRepository, generate, logError: () => {} });
  const app = createApp({
    config,
    logError: () => {},
    routers: [
      createAuthRouter({ auth, config }),
      createKitRouter({ kits: createKitService({ kits: kitRepository, runner }), requireUser: createRequireUser(auth) }),
    ],
  });

  const signIn = async (email: string) => {
    const browser = request.agent(app);
    await browser.post("/api/auth/register").send({ email, password: "a-long-enough-password" });
    return browser;
  };
  return { app, runner, kitRepository, signIn };
}

const posting = { jd: "Senior Frontend Engineer\n\nRequirements\n- 5+ years with React", companyUrl: "https://acme.example/", days: 5 };

describe("kit routes — signed out", () => {
  it.each([
    ["get", "/api/kits"],
    ["post", "/api/kits"],
    ["post", "/api/kits/bulk"],
    ["get", "/api/kits/abc"],
    ["delete", "/api/kits/abc"],
    ["post", "/api/kits/abc/retry"],
  ] as const)("refuses %s %s with the 401 envelope", async (method, path) => {
    const response = await request(setup().app)[method](path).send(posting);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("POST /api/kits", () => {
  it("answers 202 with a queued kit, without waiting for generation", async () => {
    const { signIn } = setup(() => new Promise(() => {})); // a pipeline that never finishes
    const ada = await signIn("ada@example.com");

    const response = await ada.post("/api/kits").send(posting);

    expect(response.status).toBe(202);
    expect(response.body.kit).toMatchObject({ id: expect.any(String), status: "queued", title: "Senior Frontend Engineer", days: 5 });
  });

  it("lists every invalid field", async () => {
    const ada = await setup().signIn("ada@example.com");
    const response = await ada.post("/api/kits").send({ jd: "   ", days: 2.5 });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      { path: "jd", message: "Paste the job description" },
      { path: "days", message: "Days must be a whole number" },
    ]);
  });

  it("accepts a missing or malformed company address: that costs the research, not the kit", async () => {
    const ada = await setup().signIn("ada@example.com");
    expect((await ada.post("/api/kits").send({ jd: posting.jd, days: 3 })).status).toBe(202);
    expect((await ada.post("/api/kits").send({ jd: `${posting.jd}!`, companyUrl: "not a url", days: 3 })).status).toBe(202);
  });

  it("answers 409 for the same posting again, with the existing kit's id so the interface can open it", async () => {
    const ada = await setup().signIn("ada@example.com");
    const first = await ada.post("/api/kits").send(posting);
    const second = await ada.post("/api/kits").send({ ...posting, days: 30 });

    expect(second.status).toBe(409);
    expect(second.body.error).toEqual({
      code: "KIT_ALREADY_EXISTS",
      message: "You already have a kit for this job description and company",
      details: { kitId: first.body.kit.id, status: expect.any(String) },
    });
  });
});

describe("POST /api/kits with force — 'generate a fresh kit anyway'", () => {
  it("creates a second kit alongside the original", async () => {
    const { signIn, kitRepository } = setup();
    const ada = await signIn("ada@example.com");
    await ada.post("/api/kits").send(posting);

    const forced = await ada.post("/api/kits").set("Idempotency-Key", "press-0001").send({ ...posting, force: true });

    expect(forced.status).toBe(202);
    expect(kitRepository.all()).toHaveLength(2);
  });

  it("makes one kit when the same press arrives twice, as a double-click does", async () => {
    const { signIn, kitRepository } = setup();
    const ada = await signIn("ada@example.com");
    await ada.post("/api/kits").send(posting);

    const press = () => ada.post("/api/kits").set("Idempotency-Key", "press-0002").send({ ...posting, force: true });
    const [first, second] = await Promise.all([press(), press()]);

    expect([first.status, second.status].sort()).toEqual([202, 409]);
    const created = first.status === 202 ? first : second;
    const refused = first.status === 202 ? second : first;
    expect(refused.body.error.details.kitId).toBe(created.body.kit.id); // the interface opens the one that was made
    expect(kitRepository.all()).toHaveLength(2); // the original and one fresh kit, not three
  });

  it("treats a second, separate press as a new request", async () => {
    const { signIn, kitRepository } = setup();
    const ada = await signIn("ada@example.com");
    await ada.post("/api/kits").set("Idempotency-Key", "press-0003").send({ ...posting, force: true });
    await ada.post("/api/kits").set("Idempotency-Key", "press-0004").send({ ...posting, force: true });
    expect(kitRepository.all()).toHaveLength(2);
  });

  it("ignores the key on an ordinary request: content decides, so a repeat is still a repeat", async () => {
    const ada = await setup().signIn("ada@example.com");
    await ada.post("/api/kits").set("Idempotency-Key", "press-0005").send(posting);
    const again = await ada.post("/api/kits").set("Idempotency-Key", "press-0006").send(posting);
    expect(again.status).toBe(409);
  });

  it("rejects a malformed key", async () => {
    const ada = await setup().signIn("ada@example.com");
    const response = await ada.post("/api/kits").set("Idempotency-Key", "no spaces allowed").send({ ...posting, force: true });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });
});

describe("POST /api/kits/bulk — several roles from one file", () => {
  it("creates the good rows and reports the others, row by row", async () => {
    const { signIn, kitRepository } = setup();
    const ada = await signIn("ada@example.com");
    await ada.post("/api/kits").send(posting);

    const response = await ada.post("/api/kits/bulk").send({
      items: [
        { jd: "Backend Engineer\n- Go", companyUrl: "https://globex.example/", days: 7 },
        posting, // already has a kit
        { jd: "", days: 3 }, // invalid
        { jd: "QA Engineer\n- Cypress", days: 2, force: true }, // force is ignored in a file
      ],
    });

    expect(response.status).toBe(202);
    expect(response.body.results.map((r: { status: string }) => r.status)).toEqual(["created", "duplicate", "invalid", "created"]);
    expect(response.body.results[1]).toMatchObject({ index: 1, kitId: expect.any(String) });
    expect(response.body.results[2].details).toEqual([{ path: "jd", message: "Paste the job description" }]);
    expect(kitRepository.all()).toHaveLength(3);
  });

  it("refuses an empty file and one with too many roles", async () => {
    const ada = await setup().signIn("ada@example.com");
    expect((await ada.post("/api/kits/bulk").send({ items: [] })).body.error.details[0].message).toBe("The file contains no roles");
    const tooMany = await ada.post("/api/kits/bulk").send({ items: Array.from({ length: 11 }, (_, i) => ({ jd: `Role ${i}`, days: 1 })) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details[0].message).toBe("Upload at most 10 roles at a time");
  });
});

describe("watching a kit generate", () => {
  it("shows progress while it runs, then the finished kit", async () => {
    let finish!: () => void;
    const { signIn, runner } = setup(async (_input, onProgress) => {
      onProgress(step("jd_profile", "started"));
      onProgress(step("jd_profile", "completed"));
      await new Promise<void>((resolve) => (finish = resolve));
      onProgress(step("validate_kit", "completed"));
      return sampleKit({ company: "Acme" });
    });
    const ada = await signIn("ada@example.com");
    const { id } = (await ada.post("/api/kits").send(posting)).body.kit;
    await new Promise((resolve) => setTimeout(resolve, 20));

    const during = (await ada.get(`/api/kits/${id}`)).body.kit;
    expect(during.status).toBe("running");
    expect(during.kit).toBeNull();
    expect(during.progress.map((e: ProgressEvent) => `${e.step}:${e.status}`)).toEqual(["jd_profile:started", "jd_profile:completed"]);

    finish();
    await runner.idle();

    const after = (await ada.get(`/api/kits/${id}`)).body.kit;
    expect(after.status).toBe("ready");
    expect(after.kit.source.company).toBe("Acme");
    expect(after.progress).toHaveLength(3);
    expect(after).not.toHaveProperty("userId");
    expect(after).not.toHaveProperty("fingerprint");
  });

  it("shows why a kit failed, and lets it be retried under the same id", async () => {
    let attempts = 0;
    const { signIn, runner } = setup(async () => {
      if (attempts++ === 0) throw new PipelineError("LLM_RATE_LIMITED", "Every configured model is rate-limited");
      return sampleKit();
    });
    const ada = await signIn("ada@example.com");
    const { id } = (await ada.post("/api/kits").send(posting)).body.kit;
    await runner.idle();

    expect((await ada.get(`/api/kits/${id}`)).body.kit).toMatchObject({
      status: "failed",
      error: { code: "LLM_RATE_LIMITED", message: "Every configured model is rate-limited" },
    });

    const retry = await ada.post(`/api/kits/${id}/retry`);
    expect(retry.status).toBe(202);
    expect(retry.body.kit).toMatchObject({ id, status: "queued" });
    await runner.idle();
    expect((await ada.get(`/api/kits/${id}`)).body.kit.status).toBe("ready");
  });
});

describe("a user only ever reaches their own kits", () => {
  it("lists only the caller's kits", async () => {
    const { signIn, runner } = setup();
    const ada = await signIn("ada@example.com");
    const grace = await signIn("grace@example.com");
    await ada.post("/api/kits").send(posting);
    await grace.post("/api/kits").send(posting);
    await runner.idle();

    const list = (await ada.get("/api/kits")).body.kits;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "ready", title: "Senior Frontend Engineer", company: "Acme" });
    expect(list[0]).not.toHaveProperty("kit");
  });

  it("answers 404 for someone else's kit on every route, exactly as for a kit that does not exist", async () => {
    const { signIn } = setup();
    const ada = await signIn("ada@example.com");
    const grace = await signIn("grace@example.com");
    const { id } = (await ada.post("/api/kits").send(posting)).body.kit;

    const notFound = { error: { code: "KIT_NOT_FOUND", message: "That kit does not exist" } };
    for (const response of [await grace.get(`/api/kits/${id}`), await grace.delete(`/api/kits/${id}`), await grace.post(`/api/kits/${id}/retry`)]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
    }
    expect((await grace.get("/api/kits/does-not-exist")).body).toEqual(notFound);
    expect((await ada.get(`/api/kits/${id}`)).status).toBe(200); // untouched
  });

  it("deletes the caller's own kit", async () => {
    const ada = await setup().signIn("ada@example.com");
    const { id } = (await ada.post("/api/kits").send(posting)).body.kit;
    expect((await ada.delete(`/api/kits/${id}`)).status).toBe(204);
    expect((await ada.get(`/api/kits/${id}`)).status).toBe(404);
  });
});

describe("creation limit", () => {
  it("stops one account spending the shared model quota", async () => {
    const ada = await setup().signIn("ada@example.com");
    for (let i = 0; i < KITS_PER_HOUR; i++) {
      expect((await ada.post("/api/kits").send({ jd: `Role number ${i}`, days: 1 })).status).toBe(202);
    }
    const blocked = await ada.post("/api/kits").send({ jd: "One too many", days: 1 });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_KITS");
  });
});
