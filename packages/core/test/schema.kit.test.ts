import { describe, expect, it } from 'vitest';
import { kitSchema, validateKit } from '../src';
import { makeKit } from './fixtures/kit';
import template from './fixtures/appendix-a.template.json';

const EXTENSION_KEYS = ['warnings', 'research_log', 'hiring_process', 'requirement_evidence', 'public_discussion'];

// Flattens an object to its key paths; arrays collapse to `[]` using their first element.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.length ? keyPaths(value[0], `${prefix}[]`) : [];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k;
      return [path, ...keyPaths(v, path)];
    });
  }
  return [];
}

function issuesFor(kit: unknown): string[] {
  const result = validateKit(kit);
  return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
}

describe('kit schema — Appendix A contract', () => {
  it('accepts a valid kit', () => {
    expect(issuesFor(makeKit())).toEqual([]);
  });

  it('has exactly the field names Appendix A gives, no more and no fewer', () => {
    const parsed = kitSchema.parse(makeKit());
    const ours = keyPaths(parsed).filter((p) => !EXTENSION_KEYS.some((k) => p === k || p.startsWith(`${k}.`) || p.startsWith(`${k}[]`)));
    expect(new Set(ours)).toEqual(new Set(keyPaths(template)));
  });

  it('keeps top-level extensions and strips unknown keys inside Appendix A objects', () => {
    const kit = {
      ...makeKit(),
      warnings: [{ code: 'NO_HIRING_PAGE', message: 'No hiring page found on the company site.' }],
    };
    (kit.questions[0] as Record<string, unknown>).meta = { edited: true };

    const parsed = kitSchema.parse(kit);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.questions[0]).not.toHaveProperty('meta');
  });

  it('accepts every extension populated, and rejects a malformed one', () => {
    const kit = {
      ...makeKit(),
      research_log: [
        { step: 'crawl', url: 'http://localhost:8099/acme/careers', outcome: 'failed', reason: 'HTTP 404' },
        { step: 'public_discussion', url: null, outcome: 'empty', reason: 'no relevant results' },
      ],
      hiring_process: {
        found: true,
        stages: [{ name: 'Take-home', description: 'Four-hour exercise, reviewed in a follow-up call.' }],
        source: 'http://localhost:8099/acme/handbook/how-we-hire',
      },
      requirement_evidence: { r1: '5+ years of professional React experience' },
    };
    expect(issuesFor(kit)).toEqual([]);

    const broken = { ...kit, research_log: [{ step: 'crawl', url: null, outcome: 'exploded', reason: null }] };
    expect(issuesFor(broken).some((i) => i.startsWith('research_log.0.outcome:'))).toBe(true);
  });

  it('accepts a thin kit: no requirements, no questions, still N scheduled days', () => {
    const kit = makeKit();
    kit.role.requirements = [];
    kit.questions = [];
    kit.flashcards = [];
    kit.coverage = { uncovered_requirement_ids: [], passes: 1 };
    kit.schedule.days = kit.schedule.days.map((d) => ({ ...d, question_ids: [] }));
    expect(issuesFor(kit)).toEqual([]);
  });
});

describe('kit schema — field rules', () => {
  it.each([
    ['float minutes', (k: ReturnType<typeof makeKit>) => { k.schedule.days[0]!.minutes = 22.5; }, 'schedule.days.0.minutes'],
    ['zero minutes', (k) => { k.schedule.days[0]!.minutes = 0; }, 'schedule.days.0.minutes'],
    ['difficulty above 3', (k) => { k.questions[0]!.difficulty = 4; }, 'questions.0.difficulty'],
    ['unknown priority', (k) => { (k.role.requirements[0] as { priority: string }).priority = 'required'; }, 'role.requirements.0.priority'],
    ['unknown category', (k) => { (k.questions[0] as { category: string }).category = 'system design'; }, 'questions.0.category'],
    ['non-http page url', (k) => { k.source.pages_used = ['file:///etc/passwd']; }, 'source.pages_used.0'],
    ['non-ISO researched_at', (k) => { k.source.researched_at = 'yesterday'; }, 'source.researched_at'],
  ] as [string, (k: ReturnType<typeof makeKit>) => void, string][])('rejects %s', (_name, breakIt, path) => {
    const kit = makeKit();
    breakIt(kit);
    expect(issuesFor(kit).some((i) => i.startsWith(`${path}:`))).toBe(true);
  });
});

describe('kit schema — cross references', () => {
  it('rejects a question pointing at a requirement that does not exist', () => {
    const kit = makeKit();
    kit.questions[0]!.requirement_ids = ['r9'];
    expect(issuesFor(kit)).toContain('questions.0.requirement_ids: unknown requirement id r9');
  });

  it('rejects a flashcard pointing at a requirement that does not exist', () => {
    const kit = makeKit();
    kit.flashcards[0]!.requirement_ids = ['r9'];
    expect(issuesFor(kit)).toContain('flashcards.0.requirement_ids: unknown requirement id r9');
  });

  it('rejects a scheduled question id that does not exist', () => {
    const kit = makeKit();
    kit.schedule.days[1]!.question_ids = ['q2', 'q42'];
    expect(issuesFor(kit)).toContain('schedule.days.1.question_ids: unknown question id q42');
  });

  it('rejects a schedule whose length differs from days_available', () => {
    const kit = makeKit();
    kit.schedule.days_available = 5;
    expect(issuesFor(kit)).toContain('schedule.days: expected 5 days, got 2');
  });

  it('rejects day numbers that are not 1..N in order', () => {
    const kit = makeKit();
    kit.schedule.days[1]!.day = 3;
    expect(issuesFor(kit)).toContain('schedule.days.1.day: expected day 2, got 3');
  });

  it('rejects duplicate ids', () => {
    const kit = makeKit();
    kit.questions[1]!.id = 'q1';
    expect(issuesFor(kit)).toContain('questions: duplicate question id q1');
  });

  it('rejects an uncovered id that is not a requirement', () => {
    const kit = makeKit();
    kit.coverage.uncovered_requirement_ids = ['r7'];
    expect(issuesFor(kit)).toContain('coverage.uncovered_requirement_ids: unknown requirement id r7');
  });
});
