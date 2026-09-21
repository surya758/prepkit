import type { Kit } from "@prepkit/core";

/** A small valid kit, standing in for what the pipeline returns. */
export function sampleKit(overrides: { title?: string; company?: string; days?: number } = {}): Kit {
  const days = overrides.days ?? 2;
  return {
    source: {
      company: overrides.company ?? "Acme",
      company_url: "https://acme.example/",
      role: overrides.title ?? "Senior Frontend Engineer",
      location: "",
      jd_chars: 120,
      researched_at: "2026-09-21T10:00:00.000Z",
      pages_used: ["https://acme.example/"],
    },
    company_brief: { summary: "Acme builds route planning software.", what_they_do: "Route planning.", sources: ["https://acme.example/"] },
    role: {
      title: overrides.title ?? "Senior Frontend Engineer",
      seniority: "senior",
      responsibilities: [],
      requirements: [{ id: "r1", text: "5+ years with React", kind: "technical", priority: "must" }],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "Where should state live?", answer_outline: "Colocate.", difficulty: 2 },
    ],
    flashcards: [{ id: "f1", front: "useMemo?", back: "Caches a value.", requirement_ids: ["r1"] }],
    schedule: {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({ day: i + 1, focus: "Technical", question_ids: i === 0 ? ["q1"] : [], minutes: 15 })),
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    warnings: [],
    research_log: [],
  };
}
