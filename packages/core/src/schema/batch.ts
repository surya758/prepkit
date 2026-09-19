import { z } from 'zod';
import { kitSchema } from './kit';

// Appendix B. One entry per input case, keyed by the id we were given.

export const batchCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  // Deliberately a plain string: a malformed URL degrades the kit, it does not reject the case.
  company_url: z.string(),
  // The brief tests 1 and 60. A year is a sanity ceiling, not a spec value.
  days: z.int().min(1).max(365),
});
// No array schema on purpose: the CLI parses cases one at a time, so one bad
// case is recorded as failed instead of rejecting the whole input file.

export const batchErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const batchEntrySchema = z.discriminatedUnion('status', [
  z.object({ id: z.string().min(1), status: z.literal('ok'), kit: kitSchema, error: z.null() }),
  z.object({ id: z.string().min(1), status: z.literal('failed'), kit: z.null(), error: batchErrorSchema }),
]);

export const batchOutputSchema = z.object({
  version: z.literal('1.0'),
  generated_at: z.iso.datetime(),
  kits: z.array(batchEntrySchema),
});

export type BatchCase = z.infer<typeof batchCaseSchema>;
export type BatchError = z.infer<typeof batchErrorSchema>;
export type BatchEntry = z.infer<typeof batchEntrySchema>;
export type BatchOutput = z.infer<typeof batchOutputSchema>;
