import { request } from "./support/http";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuthRouter } from "../src/auth/routes";
import { createAuthService } from "../src/auth/service";
import { loadConfig } from "../src/config";
import { createJobRunner } from "../src/kits/job-runner";
import type { GenerateFn } from "../src/kits/job-runner";
import { createKitRouter } from "../src/kits/routes";
import { createKitService } from "../src/kits/service";
import { createRequireUser } from "../src/middleware/require-user";
import { createPracticeRouter } from "../src/practice/routes";
import { createPracticeService } from "../src/practice/service";
import { createMemoryKitRepository, createMemoryPracticeRepository, createMemorySessionRepository, createMemoryUserRepository } from "./support/memory-repositories";
import { sampleKit } from "./support/sample-kit";

/** Two cards on r1, and a company card linked to nothing. */
const threeCards: GenerateFn = async () => ({
  ...sampleKit(),
  flashcards: [
    { id: "f1", front: "useMemo?", back: "Caches a value.", requirement_ids: ["r1"] },
    { id: "f2", front: "What triggers a re-render?", back: "State, props, context.", requirement_ids: ["r1"] },
    { id: "f3", front: "What does Acme sell?", back: "Route planning.", requirement_ids: [] },
  ],
});

/** The API over in-memory storage: sign in, create a kit through the real route, practise it. */
function setup(generate: GenerateFn = threeCards) {
  const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: "mongodb://unused-in-tests/prepkit" });
  const auth = createAuthService({ users: createMemoryUserRepository(), sessions: createMemorySessionRepository() });
  const kitRepository = createMemoryKitRepository();
  const practiceRepository = createMemoryPracticeRepository();
  const runner = createJobRunner({ kits: kitRepository, generate, logError: () => {} });
  const requireUser = createRequireUser(auth);
  const app = createApp({
    config,
    logError: () => {},
    routers: [
      createAuthRouter({ auth, config }),
      createKitRouter({ kits: createKitService({ kits: kitRepository, runner, practice: practiceRepository }), requireUser }),
      createPracticeRouter({ practice: createPracticeService({ kits: kitRepository, practice: practiceRepository }), requireUser }),
    ],
  });

  const signIn = async (email: string) => {
    const browser = request.agent(app);
    await browser.post("/api/auth/register").send({ email, password: "a-long-enough-password" });
    return browser;
  };
  const readyKit = async (browser: Awaited<ReturnType<typeof signIn>>) => {
    const created = await browser.post("/api/kits").send({ jd: "Senior Frontend Engineer\n- 5+ years with React", companyUrl: "https://acme.example/", days: 2 });
    await runner.idle();
    return created.body.kit.id as string;
  };
  return { app, practiceRepository, signIn, readyKit };
}

describe("practice routes — signed out", () => {
  it.each([
    ["get", "/api/kits/abc/practice"],
    ["put", "/api/kits/abc/practice/f1"],
    ["delete", "/api/kits/abc/practice"],
  ] as const)("refuses %s %s with the 401 envelope", async (method, path) => {
    const response = await request(setup().app)[method](path).send({ confidence: 3 });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("GET /api/kits/:id/practice", () => {
  it("answers with every card unseen and the kit's own order, before any practice", async () => {
    const { signIn, readyKit } = setup();
    const ada = await signIn("ada@example.com");
    const response = await ada.get(`/api/kits/${await readyKit(ada)}/practice`);

    expect(response.status).toBe(200);
    expect(response.body.practice.order).toEqual(["f1", "f2", "f3"]);
    expect(response.body.practice.progress).toMatchObject({ total: 3, practised: 0, confident: 0 });
  });

  it("answers 404 for another user's kit", async () => {
    const { signIn, readyKit } = setup();
    const kitId = await readyKit(await signIn("ada@example.com"));
    const response = await (await signIn("grace@example.com")).get(`/api/kits/${kitId}/practice`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("KIT_NOT_FOUND");
  });

  it("answers 409 while the kit is still generating", async () => {
    const { signIn } = setup(() => new Promise(() => {}));
    const ada = await signIn("ada@example.com");
    const created = await ada.post("/api/kits").send({ jd: "Senior Frontend Engineer\n- 5+ years with React", companyUrl: "https://acme.example/", days: 2 });

    const response = await ada.get(`/api/kits/${created.body.kit.id}/practice`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("KIT_NOT_READY");
  });
});

describe("PUT /api/kits/:id/practice/:cardId", () => {
  it("records the rating and answers with the new progress and order", async () => {
    const { signIn, readyKit } = setup();
    const ada = await signIn("ada@example.com");
    const kitId = await readyKit(ada);

    await ada.put(`/api/kits/${kitId}/practice/f1`).send({ confidence: 4 });
    const response = await ada.put(`/api/kits/${kitId}/practice/f2`).send({ confidence: 1 });

    expect(response.status).toBe(200);
    expect(response.body.practice.order).toEqual(["f3", "f2", "f1"]);
    expect(response.body.practice.progress).toMatchObject({ practised: 2, confident: 1 });
    expect(response.body.practice.progress.requirements[0]).toMatchObject({ requirement_id: "r1", status: "weak" });
  });

  it.each([[0], [5], [2.5], ["3"], [null], [undefined]])("refuses a confidence of %j, saying what is allowed", async (confidence) => {
    const { signIn, readyKit, practiceRepository } = setup();
    const ada = await signIn("ada@example.com");
    const response = await ada.put(`/api/kits/${await readyKit(ada)}/practice/f1`).send({ confidence });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([{ path: "confidence", message: "Confidence is 1 (forgot), 2 (shaky), 3 (good) or 4 (easy)" }]);
    expect(practiceRepository.count()).toBe(0);
  });

  it("answers 404 for a card that is not in the kit", async () => {
    const { signIn, readyKit } = setup();
    const ada = await signIn("ada@example.com");
    const response = await ada.put(`/api/kits/${await readyKit(ada)}/practice/f99`).send({ confidence: 3 });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CARD_NOT_FOUND");
  });

  it("does not let one user rate a card in another's kit", async () => {
    const { signIn, readyKit, practiceRepository } = setup();
    const kitId = await readyKit(await signIn("ada@example.com"));
    const response = await (await signIn("grace@example.com")).put(`/api/kits/${kitId}/practice/f1`).send({ confidence: 3 });
    expect(response.status).toBe(404);
    expect(practiceRepository.count()).toBe(0);
  });
});

describe("DELETE /api/kits/:id/practice", () => {
  it("starts the kit's practice over", async () => {
    const { signIn, readyKit } = setup();
    const ada = await signIn("ada@example.com");
    const kitId = await readyKit(ada);
    await ada.put(`/api/kits/${kitId}/practice/f1`).send({ confidence: 4 });

    const response = await ada.delete(`/api/kits/${kitId}/practice`);

    expect(response.status).toBe(200);
    expect(response.body.practice.progress.practised).toBe(0);
    expect(response.body.practice.order).toEqual(["f1", "f2", "f3"]);
  });
});

describe("DELETE /api/kits/:id", () => {
  it("removes the kit's ratings along with the kit", async () => {
    const { signIn, readyKit, practiceRepository } = setup();
    const ada = await signIn("ada@example.com");
    const kitId = await readyKit(ada);
    await ada.put(`/api/kits/${kitId}/practice/f1`).send({ confidence: 4 });

    expect((await ada.delete(`/api/kits/${kitId}`)).status).toBe(204);
    expect(practiceRepository.count()).toBe(0);
  });
});
