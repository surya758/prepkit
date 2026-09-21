import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PipelineError, completeJson, createFakeProvider, createProviderChain } from "../src";

const schema = z.object({
  requirements: z.array(z.object({ text: z.string().min(1), priority: z.enum(["must", "nice"]) })),
});
const good = { requirements: [{ text: "5+ years of React", priority: "must" }] };
const request = { system: "Extract requirements. JSON only.", user: "<job_description>React, 5+ years.</job_description>", schema };

describe("completeJson — one model", () => {
  it("returns the validated object when the first reply is good", async () => {
    const model = createFakeProvider([good]);
    expect(await completeJson(model, request)).toEqual({
      value: good,
      provider: "fake-model",
      usedFallback: false,
      reasked: false,
    });
    expect(model.calls).toHaveLength(1);
  });

  it("accepts a fenced reply without spending another call", async () => {
    const model = createFakeProvider(["```json\n" + JSON.stringify(good) + "\n```"]);
    expect((await completeJson(model, request)).reasked).toBe(false);
  });

  it("re-asks once, quoting the reply and naming exactly what was wrong", async () => {
    const wrong = { requirements: [{ text: "5+ years of React", priority: "required" }] };
    const model = createFakeProvider([wrong, good]);

    const result = await completeJson(model, request);

    expect(result).toMatchObject({ value: good, reasked: true });
    const reask = model.calls[1]!;
    expect(reask.system).toBe(request.system); // instructions unchanged
    expect(reask.user).toContain(request.user); // original material still there
    expect(reask.user).toContain('"priority":"required"');
    expect(reask.user).toMatch(/requirements\.0\.priority: .*must/);
    expect(reask.user).toContain("Reply again with the corrected JSON only.");
  });

  it("re-asks when the reply has no JSON in it at all", async () => {
    const model = createFakeProvider(["I'm sorry, I can't help with that.", good]);
    const result = await completeJson(model, request);
    expect(result.reasked).toBe(true);
    expect(model.calls[1]!.user).toContain("No JSON object or array found in the response");
  });

  it("gives a cut-off reply more room on the re-ask", async () => {
    const model = createFakeProvider([{ text: '{"requirements":[{"text":"Rea', truncated: true }, good]);
    await completeJson(model, { ...request, maxOutputTokens: 1_000 });

    expect(model.calls[1]!.maxOutputTokens).toBe(1_500);
    expect(model.calls[1]!.user).toContain("The reply was cut off before the JSON was complete");
  });

  it("re-asks when the provider itself rejected the generation as invalid JSON", async () => {
    const model = createFakeProvider([new PipelineError("LLM_INVALID_JSON", "rejected by the provider"), good]);
    expect(await completeJson(model, request)).toMatchObject({ value: good, reasked: true });
  });

  it("gives up after one re-ask, with a typed error saying why", async () => {
    const model = createFakeProvider(["nope", "still nope", good]);
    await expect(completeJson(model, request)).rejects.toMatchObject({
      name: "PipelineError",
      code: "LLM_INVALID_JSON",
      message: expect.stringContaining("fake-model did not return usable JSON after one re-ask"),
    });
    expect(model.calls).toHaveLength(2); // never a third attempt
  });

  it("does not re-ask for a provider failure; that is the chain's job", async () => {
    const model = createFakeProvider([new PipelineError("LLM_RATE_LIMITED", "429")]);
    await expect(completeJson(model, request)).rejects.toMatchObject({ code: "LLM_RATE_LIMITED" });
    expect(model.calls).toHaveLength(1);
  });

  it("strips fields the schema does not know, so an injected extra key goes nowhere", async () => {
    const model = createFakeProvider([{ ...good, run_this_command: "rm -rf /" }]);
    expect((await completeJson(model, request)).value).toEqual(good);
  });
});

describe("completeJson — through the chain", () => {
  it("hands over to the next model when the first cannot produce valid JSON even after a re-ask", async () => {
    const primary = createFakeProvider(["nope", "still nope"], "gemini-3.5-flash-lite");
    const second = createFakeProvider([good], "gemini-3.1-flash-lite");

    const result = await completeJson(createProviderChain([primary, second]), request);

    expect(result).toEqual({ value: good, provider: "gemini-3.1-flash-lite", usedFallback: true, reasked: false });
    expect(primary.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(1);
  });

  it("hands over at once when the first model is rate-limited", async () => {
    const primary = createFakeProvider([new PipelineError("LLM_RATE_LIMITED", "429")], "gemini-3.5-flash-lite");
    const second = createFakeProvider([good], "gemini-3.1-flash-lite");

    const result = await completeJson(createProviderChain([primary, second]), request);
    expect(result).toMatchObject({ provider: "gemini-3.1-flash-lite", usedFallback: true });
    expect(primary.calls).toHaveLength(1);
  });

  it("the bad run from the walkthrough: rate limit, then a fenced reply with a wrong field, then a fix", async () => {
    const questions = z.object({ questions: z.array(z.object({ prompt: z.string(), difficulty: z.int().min(1).max(3) })) });
    const primary = createFakeProvider([new PipelineError("LLM_RATE_LIMITED", "429")], "gemini-3.5-flash-lite");
    const second = createFakeProvider(
      [
        '```json\n{"questions":[{"prompt":"Design optimistic updates","difficulty":"hard"}]}\n```',
        { questions: [{ prompt: "Design optimistic updates", difficulty: 3 }] },
      ],
      "gemini-3.1-flash-lite",
    );

    const result = await completeJson(createProviderChain([primary, second]), { system: "s", user: "u", schema: questions });

    expect(result).toEqual({
      value: { questions: [{ prompt: "Design optimistic updates", difficulty: 3 }] },
      provider: "gemini-3.1-flash-lite",
      usedFallback: true,
      reasked: true,
    });
  });
});

describe("fake provider", () => {
  it("fails loudly when a test scripts too few replies", async () => {
    const model = createFakeProvider([good]);
    await model.complete({ system: "s", user: "u" });
    await expect(model.complete({ system: "s", user: "u" })).rejects.toThrow(/called 2 times but only 1 replies were scripted/);
  });

  it("can answer from a function, for tests that reply according to the prompt", async () => {
    const model = createFakeProvider((req) => ({ echoed: req.user.length }));
    expect((await model.complete({ system: "s", user: "four" })).text).toBe('{"echoed":4}');
  });
});
