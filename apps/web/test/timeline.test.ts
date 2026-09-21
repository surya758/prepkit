import { describe, expect, it } from "vitest";
import { buildTimeline, stepLabel } from "@/lib/timeline";
import type { ProgressEvent } from "@/lib/timeline";

const at = "2026-09-21T10:00:00.000Z";
const started = (step: string): ProgressEvent => ({ step, status: "started", at });
const completed = (step: string, durationMs: number): ProgressEvent => ({ step, status: "completed", at, durationMs });
const states = (progress: ProgressEvent[], generating = true) => buildTimeline(progress, generating).map((s) => `${s.key}=${s.state}`);

describe("stepLabel", () => {
  it.each([
    ["jd_profile", "Reading the job description"],
    ["crawl_company_site", "Reading the company's website"],
    ["questions:technical", "Writing technical questions"],
    ["questions:system-design", "Writing system design questions"],
    ["questions:company-fit", "Writing company fit questions"],
    ["questions:repair_2:technical", "Closing a coverage gap: technical questions (pass 2)"],
    ["questions:repair_3:system-design", "Closing a coverage gap: system design questions (pass 3)"],
  ])("%s -> %s", (step, label) => {
    expect(stepLabel(step)).toBe(label);
  });

  it("still gives a readable row for a step it has never heard of", () => {
    expect(stepLabel("salary_research")).toBe("Salary research");
  });
});

describe("buildTimeline", () => {
  it("is empty before anything has been reported", () => {
    expect(buildTimeline([], true)).toEqual([]);
  });

  it("shows one row per step, however many events it has sent, in the order steps first appeared", () => {
    // jd_profile and the crawl run in parallel, so their events interleave.
    const progress = [started("validate_input"), completed("validate_input", 1), started("crawl_company_site"), started("jd_profile"), completed("jd_profile", 2100)];
    expect(states(progress)).toEqual(["validate_input=done", "crawl_company_site=running", "jd_profile=done"]);
  });

  it("keeps how long a step took", () => {
    expect(buildTimeline([started("jd_profile"), completed("jd_profile", 2100)], true)[0]).toEqual({
      key: "jd_profile",
      label: "Reading the job description",
      state: "done",
      durationMs: 2100,
    });
  });

  it("says why a step was skipped, in the pipeline's own words", () => {
    const progress: ProgressEvent[] = [{ step: "flashcards", status: "skipped", at, message: "Skipped: the time budget for this kit was used up" }];
    expect(buildTimeline(progress, true)[0]).toMatchObject({ state: "skipped", detail: "Skipped: the time budget for this kit was used up" });
  });

  it("says what went wrong in a step that failed, and carries on to the steps after it", () => {
    const progress: ProgressEvent[] = [
      started("questions:technical"),
      { step: "questions:technical", status: "failed", at, message: "Every configured model is rate-limited", durationMs: 9000 },
      started("flashcards"),
    ];
    expect(buildTimeline(progress, true)).toMatchObject([
      { key: "questions:technical", state: "failed", detail: "Every configured model is rate-limited" },
      { key: "flashcards", state: "running" },
    ]);
  });

  it("shows a coverage repair pass as its own row", () => {
    const progress = [started("questions:technical"), completed("questions:technical", 4000), started("questions:repair_2:technical")];
    expect(buildTimeline(progress, true).map((s) => s.label)).toEqual(["Writing technical questions", "Closing a coverage gap: technical questions (pass 2)"]);
  });

  it("shows nothing as running once generation has ended, as after a server restart", () => {
    const progress = [started("jd_profile"), completed("jd_profile", 2000), started("questions:technical"), started("questions:behavioural")];
    expect(states(progress, true)).toEqual(["jd_profile=done", "questions:technical=running", "questions:behavioural=running"]);
    expect(states(progress, false)).toEqual(["jd_profile=done", "questions:technical=stopped", "questions:behavioural=stopped"]);
  });

  it("does not change the events it was given", () => {
    const progress = [started("jd_profile")];
    const before = structuredClone(progress);
    buildTimeline(progress, false);
    expect(progress).toEqual(before);
  });
});
