import type { Kit } from "@prepkit/core";
import { describe, expect, it } from "vitest";
import { createPracticeService } from "../src/practice/service";
import { createMemoryKitRepository, createMemoryPracticeRepository } from "./support/memory-repositories";
import { sampleKit } from "./support/sample-kit";

const ADA = "user-ada";
const GRACE = "user-grace";

/** r1 has two cards, r2 has none. f3 is a company card, linked to no requirement. */
const practiceKit = (): Kit => {
  const kit = sampleKit();
  kit.role.requirements.push({ id: "r2", text: "Mentoring junior engineers", kind: "behavioural", priority: "must" });
  kit.flashcards = [
    { id: "f1", front: "useMemo?", back: "Caches a value.", requirement_ids: ["r1"] },
    { id: "f2", front: "What triggers a re-render?", back: "State, props, context.", requirement_ids: ["r1"] },
    { id: "f3", front: "What does Acme sell?", back: "Route planning.", requirement_ids: [] },
  ];
  return kit;
};

async function setup() {
  let time = new Date("2026-09-21T10:00:00Z").getTime();
  const now = () => new Date((time += 60_000));
  const kits = createMemoryKitRepository();
  const practice = createMemoryPracticeRepository();
  const service = createPracticeService({ kits, practice, now });

  const addKit = async (userId: string, fingerprint: string, ready = true) => {
    const at = now();
    const record = await kits.insert({
      userId,
      fingerprint,
      input: { jd: "Senior Frontend Engineer", companyUrl: "https://acme.example/", days: 2 },
      status: "queued",
      progress: [],
      error: null,
      kit: null,
      meta: null,
      rev: 0,
      createdAt: at,
      updatedAt: at,
    });
    if (ready) await kits.markReady(record!.id, practiceKit(), at);
    return record!.id;
  };

  return { kits, practice, service, addKit, kitId: await addKit(ADA, "ada-1") };
}

describe("reading practice progress", () => {
  it("starts with every card unseen, in the kit's order", async () => {
    const { service, kitId } = await setup();
    const view = await service.get(ADA, kitId);

    expect(view.order).toEqual(["f1", "f2", "f3"]);
    expect(view.progress).toMatchObject({ total: 3, practised: 0, confident: 0 });
    expect(view.progress.requirements.map((r) => [r.requirement_id, r.status])).toEqual([
      ["r1", "not_started"],
      ["r2", "no_cards"],
    ]);
  });

  it("answers the same for someone else's kit as for one that does not exist", async () => {
    const { service, kitId } = await setup();
    await expect(service.get(GRACE, kitId)).rejects.toMatchObject({ status: 404, code: "KIT_NOT_FOUND" });
    await expect(service.get(ADA, "no-such-kit")).rejects.toMatchObject({ status: 404, code: "KIT_NOT_FOUND" });
  });

  it("refuses a kit that has not finished generating", async () => {
    const { service, addKit } = await setup();
    const queued = await addKit(ADA, "ada-2", false);
    await expect(service.get(ADA, queued)).rejects.toMatchObject({
      status: 409,
      code: "KIT_NOT_READY",
      message: "This kit cannot be practised while it is queued",
    });
  });
});

describe("rating a card", () => {
  it("returns the progress and the next order with the rating already counted", async () => {
    const { service, kitId } = await setup();
    await service.rate(ADA, kitId, "f1", 4);
    const view = await service.rate(ADA, kitId, "f2", 1);

    expect(view.order).toEqual(["f3", "f2", "f1"]); // unseen, then forgot, then easy
    expect(view.progress).toMatchObject({ total: 3, practised: 2, confident: 1 });
    expect(view.progress.requirements[0]).toMatchObject({ requirement_id: "r1", practised: 2, status: "weak" });
  });

  it("keeps the latest rating of a card and counts each review", async () => {
    const { service, kitId } = await setup();
    await service.rate(ADA, kitId, "f1", 1);
    const view = await service.rate(ADA, kitId, "f1", 3);

    expect(view.progress.cards[0]).toEqual({ card_id: "f1", status: "confident", confidence: 3, reps: 2, reviewed_at: "2026-09-21T10:03:00.000Z" });
  });

  it("counts both of two ratings that arrive together", async () => {
    const { service, kitId } = await setup();
    await Promise.all([service.rate(ADA, kitId, "f1", 2), service.rate(ADA, kitId, "f1", 2)]);
    expect((await service.get(ADA, kitId)).progress.cards[0]).toMatchObject({ reps: 2 });
  });

  it("refuses a card that is not in the kit, and records nothing", async () => {
    const { service, practice, kitId } = await setup();
    await expect(service.rate(ADA, kitId, "f99", 3)).rejects.toMatchObject({ status: 404, code: "CARD_NOT_FOUND" });
    expect(practice.count()).toBe(0);
  });

  it("does not let one user rate a card in another user's kit", async () => {
    const { service, practice, kitId } = await setup();
    await expect(service.rate(GRACE, kitId, "f1", 3)).rejects.toMatchObject({ status: 404, code: "KIT_NOT_FOUND" });
    expect(practice.count()).toBe(0);
  });

  it("keeps each kit's ratings apart, even though card ids repeat between kits", async () => {
    const { service, addKit, kitId } = await setup();
    const other = await addKit(ADA, "ada-2");
    await service.rate(ADA, kitId, "f1", 4);

    expect((await service.get(ADA, other)).progress.practised).toBe(0);
  });
});

describe("a card deleted in the builder", () => {
  it("drops out of the progress and the order, whatever was recorded for it", async () => {
    const { service, kits, kitId } = await setup();
    await service.rate(ADA, kitId, "f2", 1);

    const record = kits.peek(kitId);
    const kit = { ...record.kit!, flashcards: record.kit!.flashcards.filter((f) => f.id !== "f2") };
    expect(await kits.saveEdited(kitId, ADA, record.rev, kit, record.meta!, new Date())).toBe(true);

    const view = await service.get(ADA, kitId);
    expect(view.order).toEqual(["f1", "f3"]);
    expect(view.progress).toMatchObject({ total: 2, practised: 0 });
  });
});

describe("starting over", () => {
  it("forgets this kit's ratings and nobody else's", async () => {
    const { service, practice, addKit, kitId } = await setup();
    const graces = await addKit(GRACE, "grace-1");
    await service.rate(ADA, kitId, "f1", 4);
    await service.rate(GRACE, graces, "f1", 2);

    const view = await service.reset(ADA, kitId);

    expect(view.progress.practised).toBe(0);
    expect(view.order).toEqual(["f1", "f2", "f3"]);
    expect(practice.count()).toBe(1);
    expect((await service.get(GRACE, graces)).progress.practised).toBe(1);
  });

  it("cannot be done to someone else's kit", async () => {
    const { service, practice, kitId } = await setup();
    await service.rate(ADA, kitId, "f1", 4);
    await expect(service.reset(GRACE, kitId)).rejects.toMatchObject({ code: "KIT_NOT_FOUND" });
    expect(practice.count()).toBe(1);
  });
});
