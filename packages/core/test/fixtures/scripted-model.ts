import type { LlmRequest } from "../../src";
import { createFakeProvider } from "../../src/testing";
import type { FakeProvider, FakeReply } from "../../src/testing";

// A fake model that answers by which pipeline step is asking. Steps run in parallel, so a
// plain list of replies could be consumed in the wrong order; recognising the prompt cannot.

export type StepKind = "profile" | "research" | "questions" | "flashcards";

export function stepOf(request: LlmRequest): StepKind {
  if (request.user.startsWith("<job_description>")) return "profile";
  if (request.system.includes("company brief")) return "research";
  if (request.system.includes("You write flashcards")) return "flashcards";
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

/** One card per requirement it was given, plus a company card when company facts were sent. */
export function goodFlashcards(request: LlmRequest): FakeReply {
  const cards = requirementIdsIn(request).map((id) => ({ front: `Key idea behind ${id}?`, back: `The short answer for ${id}.`, requirement_ids: [id] }));
  if (request.user.includes("<company>")) cards.push({ front: "What does the company build?", back: "What its site says it builds.", requirement_ids: [] });
  return { flashcards: cards };
}

export interface Script {
  profile?: FakeReply | ((request: LlmRequest) => FakeReply);
  research?: FakeReply;
  questions?: (request: LlmRequest) => FakeReply;
  flashcards?: FakeReply | ((request: LlmRequest) => FakeReply);
}

export function scriptedModel(script: Script, name?: string): FakeProvider {
  return createFakeProvider((request) => {
    const step = stepOf(request);
    if (step === "profile") {
      const profile = script.profile ?? new Error("no profile reply scripted");
      return typeof profile === "function" ? profile(request) : profile;
    }
    if (step === "research") return script.research ?? new Error("no research reply scripted");
    if (step === "flashcards") {
      const cards = script.flashcards ?? goodFlashcards;
      return typeof cards === "function" ? cards(request) : cards;
    }
    return (script.questions ?? goodQuestions)(request);
  }, name);
}

/** A stand-in for the Hacker News search API that always finds nothing. Keeps pipeline tests offline. */
export const noDiscussionNetwork = (async () =>
  new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
