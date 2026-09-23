import type { Requirement } from "@prepkit/core";
import { describe, expect, it } from "vitest";
import { numberRequirements } from "@/lib/requirements";

const requirements: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "nice" },
  { id: "r3", text: "Logistics", kind: "domain", priority: "must" },
];

describe("numberRequirements", () => {
  it("numbers requirements by their place in the role's list, whatever their priority", () => {
    const numbered = numberRequirements(requirements);
    expect(numbered.get("r1")).toEqual({ number: 1, text: "React" });
    expect(numbered.get("r2")).toEqual({ number: 2, text: "Mentoring" });
    expect(numbered.get("r3")).toEqual({ number: 3, text: "Logistics" });
  });

  it("has no entry for an id the kit does not have", () => {
    expect(numberRequirements(requirements).get("r9")).toBeUndefined();
  });
});
