import type { LlmRequest } from "../../src";
import { createFakeProvider } from "../../src/testing";
import type { FakeProvider, FakeReply } from "../../src/testing";

// A fake model that answers by which pipeline step is asking. Steps run in parallel, so a
// plain list of replies could be consumed in the wrong order; recognising the prompt cannot.

export type StepKind = "profile" | "research" | "questions";

export function stepOf(request: LlmRequest): StepKind {
  if (request.user.startsWith("<job_description>")) return "profile";
  if (request.system.includes("company brief")) return "research";
  return "questions";
}

export function categoryOf(request: LlmRequest): string {
  return /You write ([A-Z- ]+?) interview questions/.exec(request.system)?.[1]?.toLowerCase().replace(" ", "-") ?? "unknown";
}

/** The requirement ids a question call was given, read back out of its prompt. */
export function requirementIdsIn(request: LlmRequest): string[] {
  const block = /<requirements>\n([\s\S]*?)\n<\/requirements>/.exec(request.user)?.[1] ?? "";
  return [...block.matchAll(/^(r\d+) \[/gm)].map((m) => m[1]!);
}

export const isRepairCall = (request: LlmRequest) => request.user.includes("have no question yet");

/** A well-behaved model: one distinct question per requirement it was given, or two unlinked ones. */
export function goodQuestions(request: LlmRequest): FakeReply {
  const category = categoryOf(request);
  const ids = requirementIdsIn(request);
  const question = (topic: string, requirement_ids: string[]) => ({
    prompt: `${category} question number ${topic} about ${requirement_ids.join(" and ") || "the company"}?`,
    answer_outline: `Outline for ${topic}.`,
    difficulty: 2,
    requirement_ids,
  });
  return {
    questions: ids.length > 0 ? ids.map((id, i) => question(`${category}-${id}-${i}`, [id])) : [question(`${category}-one`, []), question(`${category}-two`, [])],
  };
}

export interface Script {
  profile?: FakeReply;
  research?: FakeReply;
  questions?: (request: LlmRequest) => FakeReply;
}

export function scriptedModel(script: Script, name?: string): FakeProvider {
  return createFakeProvider((request) => {
    const step = stepOf(request);
    if (step === "profile") return script.profile ?? new Error("no profile reply scripted");
    if (step === "research") return script.research ?? new Error("no research reply scripted");
    return (script.questions ?? goodQuestions)(request);
  }, name);
}
