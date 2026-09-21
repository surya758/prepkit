// Models asked for JSON mostly return JSON — and sometimes wrap it in a code fence, add a
// sentence before it, or leave a trailing comma. Each of those is recoverable without
// spending another call, so try the cheap fixes before giving up.

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; error: string };

function tryParse(text: string): JsonExtraction {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The outermost {...} or [...] in the text, whichever opens first. */
function outermostJson(text: string): string | undefined {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((i) => i !== -1);
  if (starts.length === 0) return undefined;

  const start = Math.min(...starts);
  const end = text.lastIndexOf(text[start] === "{" ? "}" : "]");
  return end > start ? text.slice(start, end + 1) : undefined;
}

export function extractJson(raw: string): JsonExtraction {
  const text = raw.trim();
  if (!text) return { ok: false, error: "The model returned an empty response" };

  const direct = tryParse(text);
  if (direct.ok) return direct;

  // ```json ... ``` fences, with or without the language tag.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = outermostJson(fenced ?? text);
  if (!candidate) return { ok: false, error: "No JSON object or array found in the response" };

  const extracted = tryParse(candidate);
  if (extracted.ok) return extracted;

  // Trailing commas before a closing bracket: the most common near-miss.
  const repaired = tryParse(candidate.replace(/,\s*([}\]])/g, "$1"));
  return repaired.ok ? repaired : { ok: false, error: `Invalid JSON: ${direct.error}` };
}
