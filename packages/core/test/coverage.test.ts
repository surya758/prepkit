import { describe, expect, it } from 'vitest';
import { MAX_COVERAGE_PASSES, checkCoverage, shouldRunAnotherPass } from '../src';
import type { Question, Requirement } from '../src';

const req = (id: string, priority: Requirement['priority'] = 'must'): Requirement => ({
  id,
  text: `requirement ${id}`,
  kind: 'technical',
  priority,
});

const question = (id: string, requirement_ids: string[]): Question => ({
  id,
  requirement_ids,
  category: 'technical',
  prompt: `prompt ${id}`,
  answer_outline: 'outline',
  difficulty: 2,
});

describe('checkCoverage', () => {
  it('reports nothing when every requirement has a question', () => {
    const report = checkCoverage([req('r1'), req('r2')], [question('q1', ['r1', 'r2'])]);
    expect(report.uncovered).toEqual([]);
    expect(report.uncoveredMust).toEqual([]);
    expect(report.coveredBy).toEqual({ r1: ['q1'], r2: ['q1'] });
  });

  it('returns gaps in requirement order and separates must from nice', () => {
    const requirements = [req('r1'), req('r2', 'nice'), req('r3'), req('r4')];
    const report = checkCoverage(requirements, [question('q1', ['r3'])]);
    expect(report.uncovered).toEqual(['r1', 'r2', 'r4']);
    expect(report.uncoveredMust).toEqual(['r1', 'r4']);
  });

  it('treats every requirement as a gap when there are no questions', () => {
    expect(checkCoverage([req('r1'), req('r2', 'nice')], []).uncovered).toEqual(['r1', 'r2']);
  });

  it('has nothing to report for a job description with no requirements', () => {
    const report = checkCoverage([], [question('q1', [])]);
    expect(report).toEqual({ uncovered: [], uncoveredMust: [], coveredBy: {} });
  });

  it('ignores references to requirements that do not exist', () => {
    const report = checkCoverage([req('r1')], [question('q1', ['r9'])]);
    expect(report.uncovered).toEqual(['r1']);
    expect(report.coveredBy).toEqual({ r1: [] });
  });

  it('counts a question once even if it lists the same requirement twice', () => {
    expect(checkCoverage([req('r1')], [question('q1', ['r1', 'r1'])]).coveredBy.r1).toEqual(['q1']);
  });
});

describe('shouldRunAnotherPass', () => {
  const clean = checkCoverage([req('r1')], [question('q1', ['r1'])]);
  const mustGap = checkCoverage([req('r1')], []);
  const niceGap = checkCoverage([req('r1', 'nice')], []);

  it('stops after the first check when nothing is missing', () => {
    expect(shouldRunAnotherPass(clean, 1)).toBe(false);
  });

  it('keeps going for an uncovered must-have until the cap', () => {
    expect(shouldRunAnotherPass(mustGap, 1)).toBe(true);
    expect(shouldRunAnotherPass(mustGap, MAX_COVERAGE_PASSES - 1)).toBe(true);
    expect(shouldRunAnotherPass(mustGap, MAX_COVERAGE_PASSES)).toBe(false);
  });

  it('gives an uncovered nice-to-have one repair attempt, then stops', () => {
    expect(shouldRunAnotherPass(niceGap, 1)).toBe(true);
    expect(shouldRunAnotherPass(niceGap, 2)).toBe(false);
  });
});
