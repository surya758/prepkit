// What the pipeline needs from a model, and nothing more. The real HTTP client, the fake
// used in tests and the fallback chain all implement this, so steps never know which
// provider they are talking to.

export interface LlmRequest {
  /** Instructions. Trusted: written by us. */
  system: string;
  /** The material to work on. Untrusted: job descriptions and fetched pages go here. */
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  /** The model hit its output limit, so the text is probably incomplete JSON. */
  truncated: boolean;
  model: string;
  totalTokens?: number;
}

export interface LlmProvider {
  /** For logs and warnings, e.g. "gemini-3.5-flash-lite". */
  name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
