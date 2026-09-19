import type { Kit } from '../../src';

// A small but fully valid kit. Tests clone it and break one thing at a time.
export function makeKit(): Kit {
  return {
    source: {
      company: 'Acme',
      company_url: 'http://localhost:8099/acme/',
      role: 'Senior Frontend Engineer',
      location: '',
      jd_chars: 1840,
      researched_at: '2026-09-19T15:04:05Z',
      pages_used: ['http://localhost:8099/acme/', 'http://localhost:8099/acme/handbook/how-we-hire'],
    },
    company_brief: {
      summary: 'Acme builds logistics software for mid-size retailers.',
      what_they_do: 'Route planning and warehouse tooling sold as a subscription.',
      sources: ['http://localhost:8099/acme/'],
    },
    role: {
      title: 'Senior Frontend Engineer',
      seniority: 'senior',
      responsibilities: ['Own the dispatcher dashboard'],
      requirements: [
        { id: 'r1', text: '5+ years with React', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Experience mentoring junior engineers', kind: 'behavioural', priority: 'must' },
        { id: 'r3', text: 'Logistics domain knowledge', kind: 'domain', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'How do you decide where state lives in a large React app?',
        answer_outline: 'Server vs client state; colocate; lift only when shared.',
        difficulty: 2,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Tell me about a time you helped a junior engineer get unstuck.',
        answer_outline: 'Situation, what you noticed, what you changed, outcome.',
        difficulty: 1,
      },
      {
        id: 'q3',
        requirement_ids: [],
        category: 'company-fit',
        prompt: 'Why logistics software, and why Acme?',
        answer_outline: 'Tie their product to something you have actually built.',
        difficulty: 1,
      },
    ],
    flashcards: [
      { id: 'f1', front: 'useMemo vs useCallback', back: 'Value vs function identity.', requirement_ids: ['r1'] },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Technical: React', question_ids: ['q1'], minutes: 15 },
        { day: 2, focus: 'Behavioural and company fit', question_ids: ['q2', 'q3'], minutes: 20 },
      ],
    },
    coverage: { uncovered_requirement_ids: ['r3'], passes: 2 },
  };
}
