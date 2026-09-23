import { PipelineError, validateKit } from "@prepkit/core";
import type { DraftQuestion, Kit } from "@prepkit/core";
import { request } from "./support/http";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuthRouter } from "../src/auth/routes";
import { createAuthService } from "../src/auth/service";
import { loadConfig } from "../src/config";
import { createBuilderRouter } from "../src/kits/builder-routes";
import { createBuilderService } from "../src/kits/builder-service";
import type { Regenerators } from "../src/kits/builder-service";
import { createJobRunner } from "../src/kits/job-runner";
import type { GenerateFn } from "../src/kits/job-runner";
import { createKitRouter } from "../src/kits/routes";
import { createKitService } from "../src/kits/service";
import { createRequireUser } from "../src/middleware/require-user";
import { createMemoryKitRepository, createMemoryPracticeRepository, createMemorySessionRepository, createMemoryUserRepository } from "./support/memory-repositories";
import { sampleKit } from "./support/sample-kit";

const fresh = (prompt: string): DraftQuestion => ({ category: "technical", prompt, requirement_ids: ["r1"], difficulty: 2, answer_outline: "Fresh outline." });

/** A kit with three technical questions and one behavioural, so there is something to regenerate around. */
function threeQuestionKit(): Kit {
  const kit = sampleKit({ days: 2 });
  kit.role.requirements.push({ id: "r2", text: "You have mentored junior engineers", kind: "behavioural", priority: "must" });
  kit.questions = [
    { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "Where should state live?", answer_outline: "Colocate.", difficulty: 2 },
    { id: "q2", requirement_ids: ["r1"], category: "technical", prompt: "How does reconciliation work?", answer_outline: "Diffing.", difficulty: 2 },
    { id: "q3", requirement_ids: ["r2"], category: "behavioural", prompt: "Tell me about mentoring.", answer_outline: "STAR.", difficulty: 2 },
  ];
  kit.flashcards = [
    { id: "f1", front: "useMemo?", back: "Caches a value.", requirement_ids: ["r1"] },
    { id: "f2", front: "Mentoring?", back: "Feedback they can act on.", requirement_ids: ["r2"] },
  ];
  kit.schedule.days = [
    { day: 1, focus: "Technical", question_ids: ["q1", "q2"], minutes: 30 },
    { day: 2, focus: "Behavioural", question_ids: ["q3"], minutes: 15 },
  ];
  return kit;
}

function setup(regenerate: Partial<Regenerators> = {}, generate: GenerateFn = async () => threeQuestionKit()) {
  const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: "mongodb://unused-in-tests/prepkit" });
  const auth = createAuthService({ users: createMemoryUserRepository(), sessions: createMemorySessionRepository() });
  const kitRepository = createMemoryKitRepository();
  const runner = createJobRunner({ kits: kitRepository, generate, logError: () => {} });
  const requireUser = createRequireUser(auth);
  const practiceRepository = createMemoryPracticeRepository();
  const builder = createBuilderService({
    kits: kitRepository,
    practice: practiceRepository,
    regenerate: {
      categoryDrafts: async () => [fresh("A fresh technical question?")],
      brief: async () => ({ summary: "A fresh summary.", what_they_do: "A fresh description.", sources: ["https://acme.example/about"] }),
      ...regenerate,
    },
  });
  const app = createApp({
    config,
    logError: () => {},
    routers: [
      createAuthRouter({ auth, config }),
      createKitRouter({ kits: createKitService({ kits: kitRepository, runner, practice: createMemoryPracticeRepository() }), requireUser }),
      createBuilderRouter({ builder, requireUser }),
    ],
  });

  const signInWithKit = async (email = "ada@example.com") => {
    const browser = request.agent(app);
    await browser.post("/api/auth/register").send({ email, password: "a-long-enough-password" });
    const { id } = (await browser.post("/api/kits").send({ jd: `Frontend Engineer for ${email}`, days: 2 })).body.kit;
    await runner.idle();
    return { browser, id };
  };
  return { app, runner, kitRepository, practiceRepository, signInWithKit };
}

const prompts = (kit: { kit: Kit }) => kit.kit.questions.map((q) => q.prompt);

describe("a freshly generated kit", () => {
  it("arrives with every item marked generated, and revision 1", async () => {
    const { browser, id } = await setup().signInWithKit();
    const { kit } = (await browser.get(`/api/kits/${id}`)).body;
    expect(kit.rev).toBe(1);
    expect(kit.meta.items.q1).toEqual({ origin: "generated", edited: false, pinned: false });
    expect(kit.meta).toMatchObject({ nextQuestion: 4, scheduleEdited: false });
  });
});

describe("editing questions over HTTP", () => {
  it("edits one question, marks it edited, and returns the whole kit as it now stands", async () => {
    const { browser, id } = await setup().signInWithKit();
    const response = await browser.patch(`/api/kits/${id}/questions/q2`).send({ prompt: "How does reconciliation work, and when is it wrong?" });

    expect(response.status).toBe(200);
    expect(response.body.kit.kit.questions[1].prompt).toBe("How does reconciliation work, and when is it wrong?");
    expect(response.body.kit.meta.items.q2.edited).toBe(true);
    expect(response.body.kit.rev).toBe(2);
    expect(validateKit(response.body.kit.kit)).toMatchObject({ ok: true });
  });

  it("adds, reorders and deletes", async () => {
    const { browser, id } = await setup().signInWithKit();

    const added = await browser.post(`/api/kits/${id}/questions`).send({ category: "technical", prompt: "My own question?", answer_outline: "Mine.", difficulty: 3 });
    expect(added.status).toBe(201);
    expect(added.body.kit.meta.items.q4).toMatchObject({ origin: "user" });

    const reordered = await browser.put(`/api/kits/${id}/questions/order`).send({ ids: ["q4", "q3", "q2", "q1"] });
    expect(reordered.body.kit.kit.questions.map((q: { id: string }) => q.id)).toEqual(["q4", "q3", "q2", "q1"]);

    const deleted = await browser.delete(`/api/kits/${id}/questions/q1`);
    expect(deleted.body.kit.kit.questions.map((q: { id: string }) => q.id)).toEqual(["q4", "q3", "q2"]);
    expect(deleted.body.kit.kit.schedule.days.flatMap((d: { question_ids: string[] }) => d.question_ids)).not.toContain("q1");
  });

  it("marks an item untouched again after an undo, and refuses one the kit does not have", async () => {
    const { browser, id } = await setup().signInWithKit();
    await browser.patch(`/api/kits/${id}/questions/q1`).send({ prompt: "Changed" });
    expect((await browser.put(`/api/kits/${id}/items/q1/edited`).send({ edited: false })).body.kit.meta.items.q1.edited).toBe(false);
    expect((await browser.put(`/api/kits/${id}/items/q99/edited`).send({ edited: false })).status).toBe(404);
  });

  it("pins and unpins", async () => {
    const { browser, id } = await setup().signInWithKit();
    expect((await browser.put(`/api/kits/${id}/items/q1/pin`).send({ pinned: true })).body.kit.meta.items.q1.pinned).toBe(true);
    expect((await browser.put(`/api/kits/${id}/items/q1/pin`).send({ pinned: false })).body.kit.meta.items.q1.pinned).toBe(false);
  });

  it.each([
    ["a question that is not there", "patch", "/questions/q404", { prompt: "x" }, 404, "ITEM_NOT_FOUND"],
    ["an unknown requirement", "patch", "/questions/q1", { requirement_ids: ["r404"] }, 400, "INVALID_EDIT"],
    ["an empty prompt", "patch", "/questions/q1", { prompt: "   " }, 400, "VALIDATION_FAILED"],
    ["a difficulty of 9", "patch", "/questions/q1", { difficulty: 9 }, 400, "VALIDATION_FAILED"],
    ["an empty change", "patch", "/questions/q1", {}, 400, "VALIDATION_FAILED"],
    ["an incomplete order", "put", "/questions/order", { ids: ["q1"] }, 400, "INVALID_EDIT"],
  ] as const)("refuses %s and leaves the kit untouched", async (_name, method, path, body, status, code) => {
    const { browser, id } = await setup().signInWithKit();
    const response = await browser[method](`/api/kits/${id}${path}`).send(body);

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect((await browser.get(`/api/kits/${id}`)).body.kit.rev).toBe(1);
  });
});

describe("flashcards, the brief and the schedule", () => {
  it("edits, adds and deletes flashcards", async () => {
    const { browser, id } = await setup().signInWithKit();
    expect((await browser.patch(`/api/kits/${id}/flashcards/f1`).send({ back: "My wording." })).body.kit.meta.items.f1.edited).toBe(true);
    expect((await browser.post(`/api/kits/${id}/flashcards`).send({ front: "STAR", back: "Situation, task, action, result." })).status).toBe(201);
    expect((await browser.delete(`/api/kits/${id}/flashcards/f1`)).body.kit.kit.flashcards.map((f: { id: string }) => f.id)).toEqual(["f2", "f3"]);
  });

  it("rewrites a field of the brief", async () => {
    const { browser, id } = await setup().signInWithKit();
    const response = await browser.patch(`/api/kits/${id}/brief`).send({ field: "summary", value: "My own notes on Acme." });
    expect(response.body.kit.kit.company_brief.summary).toBe("My own notes on Acme.");
    expect(response.body.kit.meta.items["brief.summary"].edited).toBe(true);
  });

  it("rearranges a day, which makes the schedule the user's", async () => {
    const { browser, id } = await setup().signInWithKit();
    const response = await browser.patch(`/api/kits/${id}/schedule/days/2`).send({ focus: "My deep-dive day", minutes: 90 });
    expect(response.body.kit.kit.schedule.days[1]).toMatchObject({ focus: "My deep-dive day", minutes: 90 });
    expect(response.body.kit.meta.scheduleEdited).toBe(true);
  });

  it("re-plans the schedule for a different number of days, with no model call", async () => {
    const { browser, id } = await setup({ categoryDrafts: async () => { throw new Error("no model call expected"); } }).signInWithKit();
    const response = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 7 });
    expect(response.body.kit.kit.schedule.days).toHaveLength(7);
    expect(response.body.emphasised).toEqual([]);
  });
});

describe("adaptive re-plan: practice leans the schedule", () => {
  // All three questions are must-have, difficulty 2: they tie, so only practice can change who comes first.
  const firstDay = (body: { kit: { kit: Kit } }) => body.kit.kit.schedule.days[0]!.question_ids;

  it("moves the questions of a requirement the user keeps forgetting to the first day, and says so", async () => {
    const { practiceRepository, signInWithKit } = setup();
    const { browser, id } = await signInWithKit();
    const owner = (await browser.get("/api/auth/me")).body.user.id as string;
    await practiceRepository.rate(owner, id, "f2", 1, new Date()); // forgot the mentoring card (r2)
    await practiceRepository.rate(owner, id, "f1", 4, new Date()); // React was easy (r1)

    const plain = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 3 });
    expect(firstDay(plain.body)).toEqual(["q1"]);

    const adaptive = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 3, adaptive: true });
    expect(firstDay(adaptive.body)).toEqual(["q3"]);
    expect(adaptive.body.emphasised).toEqual(["You have mentored junior engineers (×2.0)"]);
    expect(adaptive.body.kit.kit.schedule.days).toHaveLength(3);
  });

  it("is the plain plan, and names nothing, when nothing has been practised", async () => {
    const { browser, id } = await setup().signInWithKit();
    const plain = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 3 });
    const adaptive = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 3, adaptive: true });
    expect(adaptive.body.kit.kit.schedule).toEqual(plain.body.kit.kit.schedule);
    expect(adaptive.body.emphasised).toEqual([]);
  });

  it("does not read another user's ratings", async () => {
    const { practiceRepository, signInWithKit } = setup();
    const { browser, id } = await signInWithKit();
    await practiceRepository.rate("someone-else", id, "f2", 1, new Date());
    const adaptive = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "schedule", days: 3, adaptive: true });
    expect(adaptive.body.emphasised).toEqual([]);
  });
});

describe("regenerating a section", () => {
  it("replaces the untouched technical question and keeps the edited one, the user's own and the other category", async () => {
    const { browser, id } = await setup({ categoryDrafts: async () => [fresh("How do you profile a slow render?")] }).signInWithKit();
    await browser.patch(`/api/kits/${id}/questions/q1`).send({ prompt: "Edited by me" });
    await browser.post(`/api/kits/${id}/questions`).send({ category: "technical", prompt: "Written by me?", answer_outline: "Mine.", difficulty: 1, requirement_ids: ["r1"] });

    const response = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" });

    expect(response.status).toBe(200);
    // q2, the one untouched technical question, is gone. The fresh question sits after the
    // category's last question, which is the one the user added at the end of the list.
    expect(prompts(response.body.kit)).toEqual(["Edited by me", "Tell me about mentoring.", "Written by me?", "How do you profile a slow render?"]);
    expect(validateKit(response.body.kit.kit)).toMatchObject({ ok: true });
  });

  it("tells the model how many questions are being kept", async () => {
    let asked: { category: string; lockedCount: number } | undefined;
    const { browser, id } = await setup({
      categoryDrafts: async (_kit, category, lockedCount) => {
        asked = { category, lockedCount };
        return [];
      },
    }).signInWithKit();
    await browser.put(`/api/kits/${id}/items/q1/pin`).send({ pinned: true });
    await browser.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" });
    expect(asked).toEqual({ category: "technical", lockedCount: 1 });
  });

  it("keeps an edit made WHILE the model was generating", async () => {
    let release!: () => void;
    const modelIsThinking = new Promise<void>((resolve) => (release = resolve));
    const { browser, id } = await setup({
      categoryDrafts: async () => {
        await modelIsThinking;
        return [fresh("The model's fresh question?")];
      },
    }).signInWithKit();

    const regeneration = browser.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" }).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The request is in flight. The user keeps working on the same category.
    const edit = await browser.patch(`/api/kits/${id}/questions/q2`).send({ prompt: "Edited while the model was thinking" });
    expect(edit.status).toBe(200);
    release();

    const response = await regeneration;
    expect(prompts(response.body.kit)).toEqual(["Edited while the model was thinking", "The model's fresh question?", "Tell me about mentoring."]);
  });

  it("regenerates the brief around a field the user rewrote", async () => {
    const { browser, id } = await setup().signInWithKit();
    await browser.patch(`/api/kits/${id}/brief`).send({ field: "summary", value: "My own summary." });

    const response = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "brief" });
    expect(response.body.kit.kit.company_brief).toMatchObject({ summary: "My own summary.", what_they_do: "A fresh description." });
  });

  it("changes nothing when the model fails, and says why", async () => {
    const { browser, id } = await setup({
      categoryDrafts: async () => {
        throw new PipelineError("LLM_RATE_LIMITED", "Every configured model is rate-limited");
      },
    }).signInWithKit();
    const response = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "technical" });

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: "LLM_RATE_LIMITED", message: "Every configured model is rate-limited" });
    expect((await browser.get(`/api/kits/${id}`)).body.kit.rev).toBe(1);
  });

  it("keeps the existing brief when the company site cannot be read now", async () => {
    const { browser, id } = await setup({
      brief: async () => {
        throw new PipelineError("COMPANY_UNREACHABLE", "The company site could not be read, so the brief was left as it is");
      },
    }).signInWithKit();
    const response = await browser.post(`/api/kits/${id}/regenerate`).send({ section: "brief" });
    expect(response.status).toBe(409);
    expect((await browser.get(`/api/kits/${id}`)).body.kit.kit.company_brief.summary).toBe("Acme builds route planning software.");
  });

  it("rejects an unknown section or category", async () => {
    const { browser, id } = await setup().signInWithKit();
    expect((await browser.post(`/api/kits/${id}/regenerate`).send({ section: "everything" })).status).toBe(400);
    expect((await browser.post(`/api/kits/${id}/regenerate`).send({ section: "questions", category: "trivia" })).status).toBe(400);
  });
});

describe("simultaneous changes", () => {
  it("keeps both of two edits that land at the same moment", async () => {
    const { browser, id } = await setup().signInWithKit();

    const [a, b] = await Promise.all([
      browser.patch(`/api/kits/${id}/questions/q1`).send({ prompt: "First edit" }),
      browser.patch(`/api/kits/${id}/questions/q2`).send({ prompt: "Second edit" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);

    const { kit } = (await browser.get(`/api/kits/${id}`)).body;
    expect(prompts(kit).slice(0, 2)).toEqual(["First edit", "Second edit"]);
    expect(kit.rev).toBe(3); // generated, then two saved changes
  });
});

describe("who may edit, and when", () => {
  it("refuses every builder route to a signed-out visitor", async () => {
    const { app } = setup();
    expect((await request(app).patch("/api/kits/abc/questions/q1").send({ prompt: "x" })).status).toBe(401);
    expect((await request(app).post("/api/kits/abc/regenerate").send({ section: "brief" })).status).toBe(401);
  });

  it("answers 404 when the kit is someone else's, and changes nothing", async () => {
    const world = setup();
    const ada = await world.signInWithKit("ada@example.com");
    const grace = await world.signInWithKit("grace@example.com");

    const response = await grace.browser.patch(`/api/kits/${ada.id}/questions/q1`).send({ prompt: "Defaced" });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("KIT_NOT_FOUND");
    expect(prompts((await ada.browser.get(`/api/kits/${ada.id}`)).body.kit)[0]).toBe("Where should state live?");
  });

  it("refuses to edit a kit that is still generating", async () => {
    const { app, runner } = setup({}, () => new Promise(() => {}));
    void runner;
    const browser = request.agent(app);
    await browser.post("/api/auth/register").send({ email: "ada@example.com", password: "a-long-enough-password" });
    const { id } = (await browser.post("/api/kits").send({ jd: "Frontend Engineer", days: 2 })).body.kit;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const response = await browser.patch(`/api/kits/${id}/questions/q1`).send({ prompt: "Too early" });
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({ code: "KIT_NOT_READY", message: "This kit cannot be edited while it is running" });
  });
});
