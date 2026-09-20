import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_MINUTES_PER_DAY,
  QUESTION_CATEGORIES,
  buildSchedule,
  checkCoverage,
  frontLoadedSizes,
  rankQuestions,
  validateKit,
} from '../src';
import type { Question, Requirement } from '../src';
import { makeKit } from './fixtures/kit';

// Random but well-formed input: up to 12 requirements, up to 40 questions each linked to
// 0-3 existing requirements, and 1-90 days.
const scenario = fc
  .record({
    priorities: fc.array(fc.constantFrom<Requirement['priority']>('must', 'nice'), { maxLength: 12 }),
    specs: fc.array(
      fc.record({
        difficulty: fc.integer({ min: 1, max: 3 }),
        category: fc.constantFrom(...QUESTION_CATEGORIES),
        picks: fc.array(fc.nat({ max: 11 }), { maxLength: 3 }),
      }),
      { maxLength: 40 },
    ),
    days: fc.integer({ min: 1, max: 90 }),
  })
  .map(({ priorities, specs, days }) => {
    const requirements: Requirement[] = priorities.map((priority, i) => ({
      id: `r${i + 1}`,
      text: `requirement ${i + 1}`,
      kind: 'technical',
      priority,
    }));
    const questions: Question[] = specs.map((spec, i) => ({
      id: `q${i + 1}`,
      requirement_ids: [...new Set(spec.picks.filter((p) => p < requirements.length).map((p) => `r${p + 1}`))],
      category: spec.category,
      prompt: `prompt ${i + 1}`,
      answer_outline: 'outline',
      difficulty: spec.difficulty,
    }));
    return { requirements, questions, days };
  });

describe('buildSchedule — invariants that hold for any input', () => {
  it('spans exactly the requested days, numbered 1..N', () => {
    fc.assert(
      fc.property(scenario, ({ requirements, questions, days }) => {
        const schedule = buildSchedule(questions, requirements, days);
        expect(schedule.days_available).toBe(days);
        expect(schedule.days.map((d) => d.day)).toEqual(Array.from({ length: days }, (_, i) => i + 1));
      }),
    );
  });

  it('gives every day a focus and a positive integer duration within the cap', () => {
    fc.assert(
      fc.property(scenario, ({ requirements, questions, days }) => {
        for (const day of buildSchedule(questions, requirements, days).days) {
          expect(day.focus.length).toBeGreaterThan(0);
          expect(Number.isInteger(day.minutes)).toBe(true);
          expect(day.minutes).toBeGreaterThan(0);
          expect(day.minutes).toBeLessThanOrEqual(MAX_MINUTES_PER_DAY);
        }
      }),
    );
  });

  it('only schedules questions that exist, never twice in one day', () => {
    fc.assert(
      fc.property(scenario, ({ requirements, questions, days }) => {
        const known = new Set(questions.map((q) => q.id));
        for (const day of buildSchedule(questions, requirements, days).days) {
          expect(day.question_ids.every((id) => known.has(id))).toBe(true);
          expect(new Set(day.question_ids).size).toBe(day.question_ids.length);
        }
      }),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(scenario, ({ requirements, questions, days }) => {
        expect(buildSchedule(questions, requirements, days)).toEqual(buildSchedule(questions, requirements, days));
      }),
    );
  });

  it('always yields a kit the schema accepts', () => {
    fc.assert(
      fc.property(scenario, ({ requirements, questions, days }) => {
        const kit = makeKit();
        kit.role.requirements = requirements;
        kit.questions = questions;
        kit.flashcards = [];
        kit.coverage = { uncovered_requirement_ids: checkCoverage(requirements, questions).uncovered, passes: 1 };
        kit.schedule = buildSchedule(questions, requirements, days);
        expect(validateKit(kit)).toMatchObject({ ok: true });
      }),
    );
  });
});

describe('buildSchedule — invariants when there is at least one question', () => {
  const withQuestions = scenario.filter((s) => s.questions.length > 0);

  it('schedules every question and leaves no day empty', () => {
    fc.assert(
      fc.property(withQuestions, ({ requirements, questions, days }) => {
        const schedule = buildSchedule(questions, requirements, days);
        const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
        expect(questions.every((q) => scheduled.has(q.id))).toBe(true);
        expect(schedule.days.every((d) => d.question_ids.length > 0)).toBe(true);
      }),
    );
  });

  it('reaches every must-have requirement that has a question', () => {
    fc.assert(
      fc.property(withQuestions, ({ requirements, questions, days }) => {
        const schedule = buildSchedule(questions, requirements, days);
        const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
        const { coveredBy } = checkCoverage(requirements, questions);
        for (const r of requirements.filter((r) => r.priority === 'must')) {
          const covering = coveredBy[r.id]!;
          if (covering.length > 0) expect(covering.some((id) => scheduled.has(id))).toBe(true);
        }
      }),
    );
  });

  it('introduces material in rank order, so harder and higher-priority work lands earlier', () => {
    fc.assert(
      fc.property(withQuestions, ({ requirements, questions, days }) => {
        const schedule = buildSchedule(questions, requirements, days);
        const weight = new Map(rankQuestions(questions, requirements).map((r) => [r.question.id, r.weight]));

        // First exposure = each question's first appearance, in schedule order.
        const seen = new Set<string>();
        const firstExposure: number[] = [];
        for (const id of schedule.days.flatMap((d) => d.question_ids)) {
          if (!seen.has(id)) firstExposure.push(weight.get(id)!);
          seen.add(id);
        }
        for (let i = 1; i < firstExposure.length; i++) {
          expect(firstExposure[i]!).toBeLessThanOrEqual(firstExposure[i - 1]!);
        }
      }),
    );
  });

  it('schedules each question exactly once when questions outnumber days', () => {
    fc.assert(
      fc.property(
        withQuestions.filter((s) => s.questions.length >= s.days),
        ({ requirements, questions, days }) => {
          const ids = buildSchedule(questions, requirements, days).days.flatMap((d) => d.question_ids);
          expect(ids).toHaveLength(questions.length);
          expect(new Set(ids).size).toBe(questions.length);
        },
      ),
    );
  });
});

describe('frontLoadedSizes — invariants', () => {
  it('sums to the question count, never rises, and never leaves a day empty', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 90 }).chain((days) => fc.tuple(fc.constant(days), fc.integer({ min: days, max: 400 }))),
        ([days, count]) => {
          const sizes = frontLoadedSizes(count, days);
          expect(sizes).toHaveLength(days);
          expect(sizes.reduce((a, b) => a + b, 0)).toBe(count);
          expect(sizes.every((s) => s >= 1)).toBe(true);
          for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
        },
      ),
    );
  });
});
