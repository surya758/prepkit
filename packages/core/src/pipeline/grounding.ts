// "Inventing requirements a description does not contain is worse than reporting that there
// were few." A model can be told not to invent; only code can check that it did not. These
// functions decide, from the job description's own text, whether a requirement is really
// there and whether the posting called it required or optional.

// Function words, plus the filler a model adds when it tidies a requirement ("Experience
// with…", "Strong knowledge of…"). Neither says anything the posting would have to contain.
const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have in is it of on or our that the their this to we with you your will who " +
    "experience experienced strong solid good excellent proven knowledge understanding familiarity proficiency proficient " +
    "ability able skill skills background working hands-on demonstrated track record using use"
  ).split(" "),
);

// "mentoring" and "mentored" are the same claim. Crude on purpose: it only has to stop a
// reworded requirement being mistaken for an invented one.
const stem = (token: string) => (token.length > 4 ? token.replace(/(ing|ed|es|s)$/, "") : token);

/** Lowercase, straighten quotes and dashes, drop bullets and punctuation, collapse spaces. */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[^a-z0-9+#.'\s-]/g, " ")
    .replace(/(^|\s)[-.']+|[-.']+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (text: string) => normalise(text).split(" ").filter(Boolean);
const contentTokens = (text: string) => tokens(text).filter((t) => !STOPWORDS.has(t));

/** The description split into the units a requirement would be quoted from: lines, then sentences. */
function segments(jd: string): string[] {
  return jd
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export const MIN_EVIDENCE_OVERLAP = 0.8;
export const MIN_TEXT_OVERLAP = 0.7;

export interface GroundingResult {
  grounded: boolean;
  reason?: string;
  /** Index of the description line the evidence was found on, for ordering and priority. */
  lineIndex: number;
}

/**
 * A requirement is grounded when (1) its evidence quote is found in the description — exactly
 * after normalising, or with at least 80% of its words inside one line or sentence, which
 * forgives a tidied quote but not a made-up one — and (2) the requirement's own wording does
 * not introduce things the description never mentions.
 */
export function checkGrounding(jd: string, requirement: { text: string; evidence: string }): GroundingResult {
  const lines = jd.split(/\r?\n/);
  const evidence = normalise(requirement.evidence);
  if (!evidence) return { grounded: false, reason: "No evidence quote was given", lineIndex: -1 };

  let lineIndex = lines.findIndex((line) => normalise(line).includes(evidence));
  if (lineIndex === -1 && !normalise(jd).includes(evidence)) {
    const wanted = tokens(requirement.evidence);
    let best = 0;
    lines.forEach((line, index) => {
      for (const segment of segments(line)) {
        const have = new Set(tokens(segment));
        const overlap = wanted.filter((t) => have.has(t)).length / wanted.length;
        if (overlap > best) {
          best = overlap;
          lineIndex = index;
        }
      }
    });
    if (best < MIN_EVIDENCE_OVERLAP) {
      return { grounded: false, reason: "The evidence quote does not appear in the job description", lineIndex: -1 };
    }
  }

  const jdWords = new Set(tokens(jd).map(stem));
  const claimed = contentTokens(requirement.text);
  const unsupported = claimed.filter((t) => !jdWords.has(stem(t)));
  if (claimed.length > 0 && 1 - unsupported.length / claimed.length < MIN_TEXT_OVERLAP) {
    return {
      grounded: false,
      reason: `The requirement mentions things the job description does not: ${unsupported.slice(0, 5).join(", ")}`,
      lineIndex,
    };
  }
  return { grounded: true, lineIndex };
}

// How postings word optional and mandatory things, in headings and inline.
const NICE_CUES =
  /\b(nice[- ]to[- ]haves?|bonus( points)?|(is|are|as|be) a (big |huge |strong |definite )?plus|a plus\b|preferred|preferably|ideally|desirable|desired|good to have|great to have|would be (great|nice|a bonus)|optional(ly)?|not required|extra credit|advantage(ous)?)\b/i;
const MUST_CUES =
  /\b(must( have)?|required|requirements?|essential|mandatory|minimum|need to|you('ll| will)? need|what you('ll| will)? (need|bring)|qualifications|you have|we expect|non-negotiable)\b/i;

const BULLET = /^\s*([-*•·–]|\d+[.)])\s/;

// A short line is not enough: "AWS certification preferred" is a requirement, not a heading.
// A heading ends in a colon, or introduces a bulleted list, or is nothing but cue words
// ("Nice to have", "Requirements", "Preferred qualifications").
function isHeading(lines: string[], index: number): boolean {
  const trimmed = (lines[index] ?? "").trim();
  if (!trimmed || trimmed.length > 60 || BULLET.test(trimmed) || /[.!?]$/.test(trimmed)) return false;
  if (trimmed.endsWith(":")) return true;

  const next = lines.slice(index + 1).find((l) => l.trim() !== "");
  if (next !== undefined && BULLET.test(next)) return true;

  const withoutCues = trimmed.replace(new RegExp(NICE_CUES.source, "gi"), "").replace(new RegExp(MUST_CUES.source, "gi"), "");
  return normalise(withoutCues) === "";
}

export interface PriorityDecision {
  priority: "must" | "nice";
  /** Where the decision came from. "model" means the posting gave no cue either way. */
  source: "inline" | "heading" | "model";
}

/**
 * "Taken from how the posting words it." An inline cue on the requirement's own line wins
 * ("Kafka experience is a plus"), then the nearest heading above it ("Nice to have"), and
 * only when the posting gives no cue at all does the model's reading stand.
 */
export function decidePriority(jd: string, lineIndex: number, modelPriority: "must" | "nice"): PriorityDecision {
  const lines = jd.split(/\r?\n/);
  const line = lines[lineIndex] ?? "";

  if (!isHeading(lines, lineIndex)) {
    if (NICE_CUES.test(line)) return { priority: "nice", source: "inline" };
    if (MUST_CUES.test(line)) return { priority: "must", source: "inline" };
  }

  for (let i = lineIndex - 1; i >= 0; i--) {
    const above = lines[i]!;
    if (!isHeading(lines, i)) continue;
    if (NICE_CUES.test(above)) return { priority: "nice", source: "heading" };
    if (MUST_CUES.test(above)) return { priority: "must", source: "heading" };
    // A heading with no cue ("About the role") ends the section: stop looking further up.
    break;
  }
  return { priority: modelPriority, source: "model" };
}

const INJECTION_CUES =
  /\b(ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?)|disregard (the |your )?(instructions|system prompt)|you are (now )?(an? )?(ai|assistant|chatgpt|language model)|as an ai\b|system prompt|ai assistants?:)/i;

/** Lines that read as instructions to a model. Reported, never removed: see DESIGN.md. */
export function suspiciousLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => INJECTION_CUES.test(l));
}
