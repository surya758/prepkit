import { describe, expect, it } from "vitest";
import { extractJson } from "../src";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"requirements":[{"text":"React"}]}')).toEqual({
      ok: true,
      value: { requirements: [{ text: "React" }] },
    });
  });

  it.each([
    ["a json code fence", '```json\n{"a": 1}\n```'],
    ["a bare code fence", '```\n{"a": 1}\n```'],
    ["a sentence before the JSON", 'Here is the result you asked for:\n{"a": 1}'],
    ["a sentence after the JSON", '{"a": 1}\n\nLet me know if you need anything else.'],
    ["a trailing comma", '{"a": 1,}'],
    ["surrounding whitespace", '  \n {"a": 1} \n '],
  ])("recovers from %s", (_name, raw) => {
    expect(extractJson(raw)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("recovers a trailing comma inside a nested array", () => {
    expect(extractJson('{"items": [1, 2, 3,], "done": true,}')).toEqual({
      ok: true,
      value: { items: [1, 2, 3], done: true },
    });
  });

  it("handles a top-level array", () => {
    expect(extractJson("Sure: [1, 2]")).toEqual({ ok: true, value: [1, 2] });
  });

  it("keeps braces that appear inside strings", () => {
    expect(extractJson('{"prompt": "What does {} mean in JS?"}')).toEqual({
      ok: true,
      value: { prompt: "What does {} mean in JS?" },
    });
  });

  it.each([
    ["an empty response", "", "The model returned an empty response"],
    ["prose with no JSON", "I cannot help with that.", "No JSON object or array found in the response"],
  ])("reports %s", (_name, raw, error) => {
    expect(extractJson(raw)).toEqual({ ok: false, error });
  });

  it("reports JSON cut off mid-way, as happens when the output limit is hit", () => {
    const result = extractJson('{"questions": [{"prompt": "Explain closures", "diff');
    expect(result.ok).toBe(false);
  });
});
