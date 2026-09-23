import { describe, expect, it } from 'vitest';
import {
  EMPTY_DAY_MINUTES,
  MAX_MINUTES_PER_DAY,
  buildSchedule,
  frontLoadedSizes,
  rankQuestions,
  validateKit,
} from '../src';
import type { Question, Requirement } from '../src';
import { makeKit } from './fixtures/kit';

const requirements: Requirement[] = [
  { id: 'r1', text: '5+ years with React', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Experience mentoring junior engineers', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Logistics domain knowledge', kind: 'domain', priority: 'nice' },
];

const question = (
  id: string,
  requirement_ids: string[],
  difficulty: number,
  category: Question['category'] = 'technical',
): Question => ({ id, requirement_ids, category, prompt: `prompt ${id}`, answer_outline: 'outline', difficulty });

// Deliberately out of rank order, so the tests prove sorting rather than echoing input.
const questions: Question[] = [
  question('q1', ['r3'], 1), // nice, easy       -> weight 1
  question('q2', ['r1'], 3), // must, hard       -> weight 9
  question('q3', [], 1, 'company-fit'), //          weight 2
  question('q4', ['r2'], 2, 'behavioural'), //      weight 6
  question('q5', ['r1'], 1), // must, easy       -> weight 3
  question('q6', ['r3'], 3), // nice, hard       -> weight 3, loses the tie to q5
];

const allIds = (schedule: ReturnType<typeof buildSchedule>) => schedule.days.flatMap((d) => d.question_ids);

describe('rankQuestions', () => {
  it('orders by priority x difficulty, must-haves winning ties', () => {
    expect(rankQuestions(questions, requirements).map((r) => r.question.id)).toEqual([
      'q2', 'q4', 'q5', 'q6', 'q3', 'q1',
    ]);
  });
});

describe('frontLoadedSizes', () => {
  it('gives every day at least one question and the early days more', () => {
    expect(frontLoadedSizes(20, 5)).toEqual([6, 5, 4, 3, 2]);
    expect(frontLoadedSizes(5, 5)).toEqual([1, 1, 1, 1, 1]);
    // 4 extras shared 3:2:1 -> 2, 1.33, 0.67; the spare one goes to the largest fraction (day 3).
    expect(frontLoadedSizes(7, 3)).toEqual([3, 2, 2]);
  });
});

describe('buildSchedule', () => {
  it('puts everything in day 1 for a 1-day schedule, highest rank first', () => {
    const schedule = buildSchedule(questions, requirements, 1);
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0]!.question_ids).toEqual(['q2', 'q4', 'q5', 'q6', 'q3', 'q1']);
    expect(schedule.days[0]!.minutes).toBe(25 + 15 + 10 + 25 + 10 + 10);
  });

  it('spreads questions over exactly N days, each scheduled once, hardest must-have first', () => {
    const schedule = buildSchedule(questions, requirements, 3);
    expect(schedule.days_available).toBe(3);
    expect(schedule.days.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(schedule.days.map((d) => d.question_ids)).toEqual([['q2', 'q4', 'q5'], ['q6', 'q3'], ['q1']]);
    expect(allIds(schedule).sort()).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
  });

  it('writes the focus in code from the day\'s categories, most represented first', () => {
    const schedule = buildSchedule(questions, requirements, 3);
    expect(schedule.days[0]!.focus).toBe('Technical + Behavioural');
    expect(schedule.days[2]!.focus).toBe('Technical');
  });

  it('fills a 60-day schedule: new material first, then review days, then a must-have recap', () => {
    const schedule = buildSchedule(questions, requirements, 60);
    expect(schedule.days).toHaveLength(60);

    const firstExposure = schedule.days.slice(0, 6);
    expect(firstExposure.map((d) => d.question_ids)).toEqual([['q2'], ['q4'], ['q5'], ['q6'], ['q3'], ['q1']]);

    const review = schedule.days.slice(6, 59);
    expect(review.every((d) => d.focus.startsWith('Review — ') && d.question_ids.length === 3)).toBe(true);
    expect(review[0]!.minutes).toBe(13 + 8 + 5); // half of 25, 15, 10, rounded up

    const last = schedule.days[59]!;
    expect(last.focus.startsWith('Final review — ')).toBe(true);
    expect(last.question_ids).toEqual(['q2', 'q4', 'q5']);
    expect(schedule.days.every((d) => Number.isInteger(d.minutes) && d.minutes > 0)).toBe(true);
  });

  it('handles one more day than questions: no review days, just the recap', () => {
    const schedule = buildSchedule(questions, requirements, 7);
    expect(schedule.days).toHaveLength(7);
    expect(schedule.days[6]!.focus.startsWith('Final review — ')).toBe(true);
  });

  it('still produces N days when there are no questions at all', () => {
    const schedule = buildSchedule([], [], 4);
    expect(schedule.days).toHaveLength(4);
    expect(schedule.days.every((d) => d.question_ids.length === 0 && d.minutes === EMPTY_DAY_MINUTES)).toBe(true);
  });

  it('caps a day at the maximum without dropping any question', () => {
    const many = Array.from({ length: 40 }, (_, i) => question(`q${i + 1}`, ['r1'], 3));
    const schedule = buildSchedule(many, requirements, 1);
    expect(schedule.days[0]!.question_ids).toHaveLength(40);
    expect(schedule.days[0]!.minutes).toBe(MAX_MINUTES_PER_DAY);
  });

  it.each([0, -2, 2.5, Number.NaN])('rejects daysAvailable = %j', (days) => {
    expect(() => buildSchedule(questions, requirements, days)).toThrow(RangeError);
  });

  it.each([1, 3, 60])('produces a schedule the kit schema accepts for %i days', (days) => {
    const kit = makeKit();
    kit.schedule = buildSchedule(kit.questions, kit.role.requirements, days);
    expect(validateKit(kit)).toMatchObject({ ok: true });
  });
});
