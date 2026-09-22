import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_EMPHASIS,
  buildSchedule,
  emphasisFromPractice,
  emphasisSummary,
  practiceProgress,
  rankQuestions,
  requirementWeakness,
  validateKit,
} from '../src';
import type { Confidence, PracticeRecord, Question, Requirement } from '../src';
import { makeKit } from './fixtures/kit';

const requirements: Requirement[] = [
  { id: 'r1', text: 'React', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'TypeScript', kind: 'technical', priority: 'must' },
  { id: 'r3', text: 'Logistics', kind: 'domain', priority: 'nice' },
];
const kit = () => ({
  role: { ...makeKit().role, requirements },
  flashcards: [
    { id: 'f1', front: 'a', back: 'b', requirement_ids: ['r1'] },
    { id: 'f2', front: 'a', back: 'b', requirement_ids: ['r1'] },
    { id: 'f3', front: 'a', back: 'b', requirement_ids: ['r2'] },
    { id: 'f4', front: 'a', back: 'b', requirement_ids: ['r3'] },
  ],
});
const rated = (cardId: string, confidence: Confidence): PracticeRecord => ({
  cardId,
  confidence,
  reps: 1,
  reviewedAt: '2026-09-22T10:00:00.000Z',
});
const progress = (records: PracticeRecord[]) => practiceProgress(kit(), records);

describe('requirementWeakness', () => {
  it('is 0 when every card was easy, 1 when every card was forgotten, between in proportion', () => {
    expect(requirementWeakness(progress([rated('f1', 4), rated('f2', 4)])).get('r1')).toBe(0);
    expect(requirementWeakness(progress([rated('f1', 1), rated('f2', 1)])).get('r1')).toBe(1);
    expect(requirementWeakness(progress([rated('f1', 1), rated('f2', 4)])).get('r1')).toBeCloseTo(0.5);
  });

  it('says nothing about a requirement with no rated cards: unknown is not weak', () => {
    const weakness = requirementWeakness(progress([rated('f1', 2)]));
    expect(weakness.has('r2')).toBe(false);
    expect(weakness.has('r3')).toBe(false);
  });
});

describe('emphasisFromPractice', () => {
  it('doubles a requirement the user forgot everything about, and leaves an easy one alone', () => {
    const emphasis = emphasisFromPractice(progress([rated('f1', 1), rated('f2', 1), rated('f3', 4)]));
    expect(emphasis.get('r1')).toBe(MAX_EMPHASIS);
    expect(emphasis.has('r2')).toBe(false);
  });

  it('gives no extra weight to a requirement rated good on average: known is known', () => {
    expect(emphasisFromPractice(progress([rated('f1', 3), rated('f2', 3)])).has('r1')).toBe(false);
    expect(emphasisFromPractice(progress([rated('f1', 2), rated('f2', 4)])).has('r1')).toBe(false); // averages to 3
  });

  it('is in proportion between good and forgotten', () => {
    const shaky = emphasisFromPractice(progress([rated('f1', 2), rated('f2', 2)])).get('r1')!;
    expect(shaky).toBeGreaterThan(1);
    expect(shaky).toBeLessThan(MAX_EMPHASIS);
  });

  it('names what would move up, weakest first', () => {
    const emphasis = emphasisFromPractice(progress([rated('f1', 2), rated('f3', 1)]));
    expect(emphasisSummary(emphasis, (id) => requirements.find((r) => r.id === id)!.text)).toEqual([
      'TypeScript (×2.0)',
      'React (×1.5)',
    ]);
  });
});

describe('the scheduler with emphasis', () => {
  const q = (id: string, reqs: string[], difficulty: number): Question => ({
    id,
    requirement_ids: reqs,
    category: 'technical',
    prompt: id,
    answer_outline: 'o',
    difficulty,
  });
  // Two must-have questions of equal difficulty: without emphasis q1 ranks first by original order.
  const questions = [q('q1', ['r1'], 2), q('q2', ['r2'], 2), q('q3', ['r3'], 3)];

  it('is the plain schedule when no emphasis is given', () => {
    expect(buildSchedule(questions, requirements, 3)).toEqual(buildSchedule(questions, requirements, 3, new Map()));
  });

  it('moves the questions of a weak requirement ahead of ones they otherwise tied with', () => {
    expect(rankQuestions(questions, requirements).map((r) => r.question.id)).toEqual(['q1', 'q2', 'q3']);
    const emphasis = new Map([['r2', 1.5]]);
    expect(rankQuestions(questions, requirements, emphasis).map((r) => r.question.id)).toEqual(['q2', 'q1', 'q3']);
    expect(buildSchedule(questions, requirements, 3, emphasis).days[0]!.question_ids).toEqual(['q2']);
  });

  it('a question covering several requirements takes the strongest need among them', () => {
    const both = [q('q1', ['r1', 'r3'], 1), q('q2', ['r1'], 1)];
    const emphasis = new Map([['r3', 2]]);
    expect(rankQuestions(both, requirements, emphasis).map((r) => r.question.id)).toEqual(['q1', 'q2']);
  });

  it('keeps every guarantee of the schedule, whatever the emphasis', () => {
    const arbitrary = fc.record({
      count: fc.integer({ min: 0, max: 15 }),
      days: fc.integer({ min: 1, max: 30 }),
      factors: fc.array(fc.double({ min: 1, max: MAX_EMPHASIS, noNaN: true }), { minLength: 3, maxLength: 3 }),
    });
    fc.assert(
      fc.property(arbitrary, ({ count, days, factors }) => {
        const qs = Array.from({ length: count }, (_, i) => q(`q${i + 1}`, [requirements[i % 3]!.id], (i % 3) + 1));
        const emphasis = new Map(requirements.map((r, i) => [r.id, factors[i]!]));
        const schedule = buildSchedule(qs, requirements, days, emphasis);
        expect(schedule.days).toHaveLength(days);
        expect(schedule.days.every((d) => Number.isInteger(d.minutes) && d.minutes > 0)).toBe(true);
        const placed = new Set(schedule.days.flatMap((d) => d.question_ids));
        for (const question of qs) expect(placed.has(question.id)).toBe(true);
        const base = makeKit();
        const checked = validateKit({
          ...base,
          role: { ...base.role, requirements },
          questions: qs,
          flashcards: [],
          schedule,
          coverage: { uncovered_requirement_ids: [], passes: 1 },
        });
        expect(checked.ok).toBe(true);
      }),
    );
  });
});
