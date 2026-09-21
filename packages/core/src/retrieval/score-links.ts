import type { CleanedPage, PageLink } from "./clean-html";

// Which links are worth fetching? The brief is explicit that a fixed list of paths is not
// enough — companies put their hiring process at /handbook/people/how-we-hire or behind a
// link called "Join the crew". So links are scored on what they say, and the URL only helps.

export type LinkKind = "hiring" | "about" | "other";

export interface ScoredLink extends PageLink {
  kind: LinkKind;
  score: number;
  /** The signals that fired, e.g. `text:how we hire`. Kept for the research log and for debugging. */
  signals: string[];
}

type Signal = [pattern: RegExp, weight: number];

// Matched against the anchor text. What a company calls the link is the best evidence.
const HIRING_TEXT: Signal[] = [
  [/\b(how we hire|hiring process|interview(ing)? process|our process|interviewing)\b/, 10],
  [/\b(recruit(ing|ment)|hiring|we'?re hiring|we are hiring)\b/, 8],
  [/\b(careers?|jobs?|open (roles|positions)|vacancies|opportunities)\b/, 7],
  [/\b(join (us|the|our)|work (with|at|for)|life at|working (at|here))\b/, 6],
];
const ABOUT_TEXT: Signal[] = [
  [/\b(about|who we are|our story|company|mission|values|what we do)\b/, 5],
  [/\b(handbook|culture|people|team|engineering)\b/, 4],
  [/\b(products?|platform|solutions|customers|how it works|blog)\b/, 3],
];

// Matched against the words of the URL path. Weaker: paths are often generic or misleading.
const HIRING_PATH: Signal[] = [
  [/\b(hiring|hire|interview(s|ing)?|recruit(ing|ment)?)\b/, 6],
  [/\b(careers?|jobs?|join|vacancies|openings)\b/, 5],
];
const ABOUT_PATH: Signal[] = [
  [/\b(about|company|mission|values|story)\b/, 3],
  [/\b(handbook|culture|people|team|engineering)\b/, 3],
  [/\b(products?|platform|customers|blog)\b/, 2],
];

// Never useful for a prep kit, whatever else the link says.
const NOISE_TEXT = /\b(privacy|terms|cookies?|legal|log ?in|sign ?(in|up)|register|cart|checkout|newsletter|subscribe|unsubscribe|rss|sitemap|status|download)\b/;
const NOISE_PATH = /\b(privacy|terms|cookies?|legal|login|signin|signup|register|cart|checkout|account|feed|rss|cdn-cgi|wp-admin|wp-json)\b/;
const NON_PAGE_EXTENSION = /\.(pdf|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|zip|gz|mp4|mp3|woff2?|docx?|xlsx?|pptx?)$/i;
const NOISE_PENALTY = 20;

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();

function total(signals: Signal[], haystack: string, label: string, fired: string[]): number {
  let sum = 0;
  for (const [pattern, weight] of signals) {
    const match = pattern.exec(haystack);
    if (match) {
      sum += weight;
      fired.push(`${label}:${match[0]}`);
    }
  }
  return sum;
}

export function scoreLink(link: PageLink): ScoredLink {
  const url = new URL(link.url);
  const text = words(link.text);
  const path = words(decodeURIComponent(url.pathname));
  const signals: string[] = [];

  const hiring = total(HIRING_TEXT, text, "text", signals) + total(HIRING_PATH, path, "path", signals);
  const about = total(ABOUT_TEXT, text, "text", signals) + total(ABOUT_PATH, path, "path", signals);

  let penalty = 0;
  if (NOISE_TEXT.test(text) || NOISE_PATH.test(path)) {
    penalty += NOISE_PENALTY;
    signals.push("noise");
  }
  if (NON_PAGE_EXTENSION.test(url.pathname)) {
    penalty += NOISE_PENALTY;
    signals.push("not-a-page");
  }

  const score = hiring + about - penalty;
  const kind: LinkKind = score <= 0 ? "other" : hiring >= about ? "hiring" : "about";
  return { ...link, kind, score, signals };
}

/** Best first. Links scoring zero or less are dropped: they are not worth a request. */
export function rankLinks(links: PageLink[]): ScoredLink[] {
  return links
    .map(scoreLink)
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length);
}

// A link's name is a promise; the page's content is the proof. "Careers" might be a list
// of openings with nothing about how interviews work, and a handbook page with a dull
// title might lay out every stage.
const PROCESS_STAGES: Signal[] = [
  [/\b(take ?home|coding (challenge|exercise|test)|technical (exercise|assessment|task))\b/, 3],
  [/\b(system design|architecture (interview|round))\b/, 3],
  [/\b(phone screen|recruiter (call|screen)|intro(ductory)? call|screening call|technical screen)\b/, 3],
  // words() turns hyphens into spaces, so "on-site" arrives here as "on site".
  [/\b(on ?site|final (round|interview)|super ?day|pair(ing| programming))\b/, 3],
  [/\b(behaviou?ral interview|values interview|culture (fit|add)|hiring manager)\b/, 3],
  [/\b(reference checks?|offer stage|make an offer|we (will )?make (you )?an offer)\b/, 2],
];
const HIRING_VOCABULARY: Signal[] = [
  [/\binterview(s|ing|ers?)?\b/, 3],
  [/\b(hiring process|how we hire|recruitment process|interview process)\b/, 4],
  [/\b(stages?|rounds?|steps?) (of|in) (the|our)\b/, 2],
  [/\b(candidates?|applicants?)\b/, 2],
  [/\b(careers?|open (roles|positions)|job openings?|vacancies|we'?re hiring|we are hiring)\b/, 3],
  [/\b(apply|application)\b/, 2],
];
const HIRING_PAGE_THRESHOLD = 5;

export interface HiringAssessment {
  score: number;
  /** The page is about working or interviewing at the company. */
  isHiringPage: boolean;
  /** It names at least two distinct interview stages — enough to shape the question mix. */
  describesProcess: boolean;
  signals: string[];
}

export function assessHiringContent(page: Pick<CleanedPage, "title" | "text">): HiringAssessment {
  const haystack = words(`${page.title}\n${page.text}`);
  const signals: string[] = [];
  const stagesBefore = signals.length;
  const stageScore = total(PROCESS_STAGES, haystack, "stage", signals);
  const stageCount = signals.length - stagesBefore;
  const score = stageScore + total(HIRING_VOCABULARY, haystack, "vocab", signals);

  return {
    score,
    isHiringPage: score >= HIRING_PAGE_THRESHOLD,
    describesProcess: stageCount >= 2,
    signals,
  };
}
