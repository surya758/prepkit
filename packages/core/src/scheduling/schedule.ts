import type { Kit, Question, Requirement, ScheduleDay } from '../schema/kit';

// Allocation is arithmetic, so it lives here and never in a prompt (brief, section 8).

export const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 10, 2: 15, 3: 25 };
export const MAX_MINUTES_PER_DAY = 480;
export const EMPTY_DAY_MINUTES = 30;
const REVIEW_QUESTIONS_PER_DAY = 3;
const FINAL_REVIEW_MAX_QUESTIONS = 8;

const CATEGORY_LABELS: Record<Question['category'], string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

type PriorityTier = 'must' | 'unlinked' | 'nice';
const TIER_WEIGHT: Record<PriorityTier, number> = { must: 3, unlinked: 2, nice: 1 };

interface Ranked {
  question: Question;
  tier: PriorityTier;
  weight: number;
}

/**
 * Requirement id -> how much more its questions should weigh, 1 (as normal) to 2 (double).
 * Where practice has shown a requirement to be weak, the questions that cover it rise in the
 * ranking and so land on earlier, fuller days. Absent, the schedule is the plain one.
 */
export type Emphasis = ReadonlyMap<string, number>;
export const MAX_EMPHASIS = 2;

function emphasisOf(question: Question, emphasis: Emphasis | undefined): number {
  if (!emphasis) return 1;
  // A question covering several requirements takes the strongest need among them.
  return question.requirement_ids.reduce((max, id) => Math.max(max, emphasis.get(id) ?? 1), 1);
}

function tierOf(question: Question, priorityById: Map<string, Requirement['priority']>): PriorityTier {
  const priorities = question.requirement_ids.map((id) => priorityById.get(id)).filter(Boolean);
  if (priorities.includes('must')) return 'must';
  // Company-fit questions often map to no requirement; they still matter more than a bonus line.
  return priorities.length === 0 ? 'unlinked' : 'nice';
}

/** Highest weight first: priority x difficulty (x emphasis), must-haves winning ties, then original order. */
export function rankQuestions(questions: Question[], requirements: Requirement[], emphasis?: Emphasis): Ranked[] {
  const priorityById = new Map(requirements.map((r) => [r.id, r.priority]));
  return questions
    .map((question, index) => {
      const tier = tierOf(question, priorityById);
      return { question, tier, weight: TIER_WEIGHT[tier] * question.difficulty * emphasisOf(question, emphasis), index };
    })
    .sort((a, b) => b.weight - a.weight || TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier] || a.index - b.index);
}

/**
 * How many questions each day gets when there are at least as many questions as days.
 * Every day gets one; the rest are shared out in proportion to D, D-1, ... 1, so day 1
 * is the heaviest and the last day the lightest. Largest-remainder rounding keeps the
 * total exact.
 */
export function frontLoadedSizes(questionCount: number, days: number): number[] {
  const extra = questionCount - days;
  const totalWeight = (days * (days + 1)) / 2;
  const shares = Array.from({ length: days }, (_, i) => (extra * (days - i)) / totalWeight);
  const sizes = shares.map((s) => 1 + Math.floor(s));

  let left = questionCount - sizes.reduce((a, b) => a + b, 0);
  const byFraction = shares
    .map((s, i) => ({ i, fraction: s - Math.floor(s) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const { i } of byFraction) {
    if (left === 0) break;
    sizes[i]! += 1;
    left -= 1;
  }
  return sizes;
}

function minutesFor(questions: Question[], review: boolean): number {
  const total = questions.reduce((sum, q) => {
    const minutes = MINUTES_BY_DIFFICULTY[q.difficulty] ?? MINUTES_BY_DIFFICULTY[2]!;
    return sum + (review ? Math.ceil(minutes / 2) : minutes);
  }, 0);
  return Math.min(total, MAX_MINUTES_PER_DAY);
}

/**
 * A day's focus is its categories, most represented first, at most two: "Technical + Behavioural".
 * The questions themselves say what the day is about; repeating requirement texts here made a
 * label too long to read.
 */
function focusFor(questions: Question[], prefix = ''): string {
  const counts = new Map<Question['category'], number>();
  for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const categories = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([category]) => CATEGORY_LABELS[category]);
  return `${prefix}${categories.join(' + ')}`;
}

export function buildSchedule(
  questions: Question[],
  requirements: Requirement[],
  daysAvailable: number,
  emphasis?: Emphasis,
): Kit['schedule'] {
  if (!Number.isInteger(daysAvailable) || daysAvailable < 1) {
    throw new RangeError(`daysAvailable must be a positive integer, got ${daysAvailable}`);
  }

  const ranked = rankQuestions(questions, requirements, emphasis);
  const days: ScheduleDay[] = [];

  const push = (dayQuestions: Question[], focus: string, review: boolean) =>
    days.push({
      day: days.length + 1,
      focus,
      question_ids: dayQuestions.map((q) => q.id),
      minutes: minutesFor(dayQuestions, review),
    });

  // A thin kit still gets exactly the days asked for; it just says what they are for.
  if (ranked.length === 0) {
    for (let i = 0; i < daysAvailable; i++) {
      days.push({
        day: i + 1,
        focus: 'Company research and general preparation',
        question_ids: [],
        minutes: EMPTY_DAY_MINUTES,
      });
    }
    return { days_available: daysAvailable, days };
  }

  const ordered = ranked.map((r) => r.question);

  if (ordered.length >= daysAvailable) {
    let cursor = 0;
    for (const size of frontLoadedSizes(ordered.length, daysAvailable)) {
      const chunk = ordered.slice(cursor, cursor + size);
      cursor += size;
      push(chunk, focusFor(chunk), false);
    }
    return { days_available: daysAvailable, days };
  }

  // More days than questions (the 60-day case): new material first, one question a day
  // in rank order, then review days that cycle through it, ending on the must-haves.
  for (const q of ordered) push([q], focusFor([q]), false);

  const mustQuestions = ranked.filter((r) => r.tier === 'must').map((r) => r.question);
  const perReview = Math.min(REVIEW_QUESTIONS_PER_DAY, ordered.length);
  let cursor = 0;
  while (days.length < daysAvailable - 1) {
    const chunk = Array.from({ length: perReview }, (_, i) => ordered[(cursor + i) % ordered.length]!);
    cursor = (cursor + perReview) % ordered.length;
    push(chunk, focusFor(chunk, 'Review — '), true);
  }
  // The last day is a light recap, not a cram: top-ranked must-haves only.
  const finalSet = (mustQuestions.length > 0 ? mustQuestions : ordered).slice(0, FINAL_REVIEW_MAX_QUESTIONS);
  push(finalSet, focusFor(finalSet, 'Final review — '), true);

  return { days_available: daysAvailable, days };
}
