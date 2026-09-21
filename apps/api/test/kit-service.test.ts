import { PipelineError } from "@prepkit/core";
import { describe, expect, it, vi } from "vitest";
import { createJobRunner } from "../src/kits/job-runner";
import type { GenerateFn } from "../src/kits/job-runner";
import { createKitService, fingerprintOf } from "../src/kits/service";
import { createMemoryKitRepository, createMemoryPracticeRepository } from "./support/memory-repositories";
import { sampleKit } from "./support/sample-kit";

const ADA = "user-ada";
const GRACE = "user-grace";
const posting = { jd: "Senior Frontend Engineer\n\nRequirements\n- 5+ years with React", companyUrl: "https://acme.example/", days: 5 };

function setup(generate: GenerateFn = async () => sampleKit()) {
  let time = new Date("2026-09-21T10:00:00Z").getTime();
  const now = () => new Date(time++);
  const kits = createMemoryKitRepository();
  const runner = createJobRunner({ kits, generate, now, logError: () => {} });
  const practice = createMemoryPracticeRepository();
  const service = createKitService({ kits, runner, practice, now });
  return { kits, runner, practice, service };
}

describe("creating a kit", () => {
  it("returns at once with a queued kit, before any generation has happened", async () => {
    const generate = vi.fn<GenerateFn>(() => new Promise(() => {})); // never finishes
    const { service } = setup(generate);

    const created = await service.create(ADA, posting);

    expect(created).toMatchObject({ id: expect.any(String), status: "queued", title: "Senior Frontend Engineer", days: 5, error: null });
  });

  it("generates in the background, and the kit becomes ready", async () => {
    const { service, runner } = setup();
    const { id } = await service.create(ADA, posting);
    await runner.idle();

    const record = await service.get(ADA, id);
    expect(record.status).toBe("ready");
    expect(record.kit?.role.title).toBe("Senior Frontend Engineer");
  });

  it("refuses the same posting twice, and says which kit already exists", async () => {
    const { service, kits } = setup();
    const first = await service.create(ADA, posting);

    await expect(service.create(ADA, posting)).rejects.toMatchObject({
      status: 409,
      code: "KIT_ALREADY_EXISTS",
      details: { kitId: first.id },
    });
    expect(kits.all()).toHaveLength(1);
  });

  it("recognises the same posting despite whitespace, capitals, a trailing slash or a different number of days", async () => {
    const { service } = setup();
    await service.create(ADA, posting);
    const variant = { jd: `  ${posting.jd.toUpperCase().replace(/\n/g, "\n   ")}  `, companyUrl: "HTTPS://acme.example", days: 30 };
    await expect(service.create(ADA, variant)).rejects.toMatchObject({ code: "KIT_ALREADY_EXISTS" });
  });

  it("treats a different company, or a different description, as a different posting", () => {
    expect(fingerprintOf(posting)).not.toBe(fingerprintOf({ ...posting, companyUrl: "https://globex.example/" }));
    expect(fingerprintOf(posting)).not.toBe(fingerprintOf({ ...posting, jd: `${posting.jd}\n- TypeScript` }));
  });

  it("makes a double-click safe: of two simultaneous submissions, one kit is created", async () => {
    const { service, kits } = setup();
    const results = await Promise.allSettled([service.create(ADA, posting), service.create(ADA, posting)]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(kits.all()).toHaveLength(1);
  });

  it("generates a fresh kit alongside the original when asked to", async () => {
    const { service, kits } = setup();
    const first = await service.create(ADA, posting);
    const second = await service.create(ADA, { ...posting, force: true });

    expect(second.id).not.toBe(first.id);
    expect(kits.all()).toHaveLength(2);
  });

  it("lets two users each have a kit for the same posting", async () => {
    const { service } = setup();
    await service.create(ADA, posting);
    await expect(service.create(GRACE, posting)).resolves.toMatchObject({ status: "queued" });
  });
});

describe("a user only ever sees their own kits", () => {
  it("lists only the caller's kits, newest first, without the description or the kit body", async () => {
    const { service, runner } = setup();
    await service.create(ADA, posting);
    await service.create(ADA, { ...posting, jd: "Backend Engineer\n\n- Go" });
    await service.create(GRACE, { ...posting, jd: "Grace's posting" });
    await runner.idle();

    const list = await service.list(ADA);
    expect(list.map((k) => k.title)).toEqual(["Senior Frontend Engineer", "Senior Frontend Engineer"]); // titles come from the generated kit
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain("Requirements");
    expect(list[0]).not.toHaveProperty("kit");
  });

  it("answers 404, not 403, for someone else's kit, so the id is not confirmed to exist", async () => {
    const { service } = setup();
    const { id } = await service.create(ADA, posting);

    const asGrace = await service.get(GRACE, id).catch((e) => e);
    const noSuchKit = await service.get(GRACE, "000000000000000000000000").catch((e) => e);

    expect(asGrace).toMatchObject({ status: 404, code: "KIT_NOT_FOUND" });
    expect({ ...asGrace }).toEqual({ ...noSuchKit });
  });

  it("does not let one user delete or retry another's kit", async () => {
    const { service, kits } = setup();
    const { id } = await service.create(ADA, posting);

    await expect(service.remove(GRACE, id)).rejects.toMatchObject({ code: "KIT_NOT_FOUND" });
    await expect(service.retry(GRACE, id)).rejects.toMatchObject({ code: "KIT_NOT_FOUND" });
    expect(kits.all()).toHaveLength(1);
  });

  it("deletes the caller's own kit", async () => {
    const { service, kits } = setup();
    const { id } = await service.create(ADA, posting);
    await service.remove(ADA, id);
    expect(kits.all()).toEqual([]);
  });

  it("takes the kit's practice ratings with it, and leaves everyone else's", async () => {
    const { service, practice } = setup();
    const { id } = await service.create(ADA, posting);
    const at = new Date("2026-09-21T10:00:00Z");
    await practice.rate(ADA, id, "f1", 3, at);
    await practice.rate(GRACE, "graces-kit", "f1", 2, at);

    await service.remove(ADA, id);

    expect(await practice.listForKit(ADA, id)).toEqual([]);
    expect(await practice.listForKit(GRACE, "graces-kit")).toHaveLength(1);
  });

  it("leaves ratings alone when the kit was not the caller's to delete", async () => {
    const { service, practice } = setup();
    const { id } = await service.create(ADA, posting);
    await practice.rate(ADA, id, "f1", 3, new Date("2026-09-21T10:00:00Z"));

    await expect(service.remove(GRACE, id)).rejects.toMatchObject({ code: "KIT_NOT_FOUND" });
    expect(practice.count()).toBe(1);
  });
});

describe("retrying a failed kit", () => {
  it("runs it again under the same id, with a clean slate", async () => {
    let attempts = 0;
    const { service, runner } = setup(async () => {
      if (attempts++ === 0) throw new PipelineError("LLM_RATE_LIMITED", "429 from every model");
      return sampleKit();
    });
    const { id } = await service.create(ADA, posting);
    await runner.idle();
    expect(await service.get(ADA, id)).toMatchObject({ status: "failed", error: { code: "LLM_RATE_LIMITED" } });

    const retried = await service.retry(ADA, id);
    expect(retried).toMatchObject({ id, status: "queued", error: null });
    await runner.idle();

    expect(await service.get(ADA, id)).toMatchObject({ status: "ready", error: null });
  });

  it("refuses to retry a kit that did not fail", async () => {
    const { service, runner } = setup();
    const { id } = await service.create(ADA, posting);
    await runner.idle();
    await expect(service.retry(ADA, id)).rejects.toMatchObject({ status: 409, code: "KIT_NOT_RETRYABLE", message: "Only a failed kit can be retried; this one is ready" });
  });
});
