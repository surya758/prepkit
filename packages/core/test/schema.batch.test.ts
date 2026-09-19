import { describe, expect, it } from 'vitest';
import { batchCaseSchema, batchOutputSchema } from '../src';
import { makeKit } from './fixtures/kit';

const envelope = (kits: unknown[]) => ({ version: '1.0', generated_at: '2026-09-01T09:12:44Z', kits });

describe('batch schema — Appendix B contract', () => {
  it('accepts the input case shape from the brief', () => {
    const parsed = batchCaseSchema.safeParse({
      id: 'case-01',
      jd: 'Senior Backend Engineer\n\nWe are looking for ...',
      company_url: 'http://localhost:8099/acme/',
      days: 5,
    });
    expect(parsed.success).toBe(true);
  });

  it('does not reject a case for a malformed company_url — that degrades the kit instead', () => {
    expect(batchCaseSchema.safeParse({ id: 'c', jd: 'x', company_url: 'not a url', days: 1 }).success).toBe(true);
  });

  it.each([1, 60, 365])('accepts days = %j', (days) => {
    expect(batchCaseSchema.safeParse({ id: 'c', jd: 'x', company_url: '', days }).success).toBe(true);
  });

  it.each([0, -1, 2.5, '5', 366])('rejects days = %j', (days) => {
    expect(batchCaseSchema.safeParse({ id: 'c', jd: 'x', company_url: '', days }).success).toBe(false);
  });

  it('accepts an ok entry and a failed entry side by side', () => {
    const output = envelope([
      { id: 'case-01', status: 'ok', kit: makeKit(), error: null },
      {
        id: 'case-04',
        status: 'failed',
        kit: null,
        error: { code: 'LLM_UNAVAILABLE', message: 'Provider still rate-limited after 3 retries.' },
      },
    ]);
    expect(batchOutputSchema.safeParse(output).success).toBe(true);
  });

  it('rejects ok without a kit, and failed without an error', () => {
    expect(batchOutputSchema.safeParse(envelope([{ id: 'a', status: 'ok', kit: null, error: null }])).success).toBe(false);
    expect(batchOutputSchema.safeParse(envelope([{ id: 'a', status: 'failed', kit: null, error: null }])).success).toBe(false);
  });

  it('rejects any version other than "1.0"', () => {
    expect(batchOutputSchema.safeParse({ ...envelope([]), version: '1' }).success).toBe(false);
  });
});
