/**
 * An expected failure with a stable code. The batch command writes it out as the
 * `error: { code, message }` of Appendix B; the API maps it to an HTTP response.
 * Anything that is not a PipelineError is treated as a bug, not as a failure mode.
 */
export class PipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PipelineError";
  }
}
