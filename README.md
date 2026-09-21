# AI Interview Prep Kit

Turns a pasted job description and a company website into a personalised interview preparation
kit: a company brief, a role breakdown, a categorised question bank, flashcards and a day-by-day
study schedule — which the user can then reshape and practise against.

Built for the Trao full-stack engineering assessment.

> **Status:** in progress. Sections marked _Pending_ are written when the component they describe
> lands, so that this file only ever documents what exists.

One rule runs through the whole design: **the model writes prose, the code makes decisions.**
Ids, coverage, scheduling, validation and case status are deterministic code. The model is never
asked to do arithmetic or to judge its own completeness.

## Contents

- [Tech stack](#tech-stack)
- [Setup](#setup)
- [LLM provider and model](#llm-provider-and-model)
- [Architecture](#architecture)
- [Retrieval approach and sources](#retrieval-approach-and-sources)
- [Research and generation steps](#research-and-generation-steps)
- [Kit structure](#kit-structure)
- [The second pass: coverage](#the-second-pass-coverage)
- [How the schedule is allocated](#how-the-schedule-is-allocated)
- [Generated, edited and pinned state](#generated-edited-and-pinned-state)
- [Practice mode](#practice-mode)
- [Long-running generation](#long-running-generation)
- [Edge cases and failure handling](#edge-cases-and-failure-handling)
- [Security](#security)
- [Creative feature](#creative-feature)
- [Design decisions, trade-offs and known limitations](#design-decisions-trade-offs-and-known-limitations)
- [Tests](#tests)

## Tech stack

TypeScript throughout, in an npm-workspaces monorepo.

| Part | Choice | Status |
|---|---|---|
| Pipeline library | `packages/core` — plain TypeScript, [zod](https://zod.dev) for the kit contract | in progress |
| Tests | vitest; fast-check for property-based tests | in place |
| Backend | Node.js + Express, MongoDB | _Pending_ |
| Frontend | Next.js + Tailwind CSS | _Pending_ |

The pipeline is a library with no web framework or database in it. The brief requires the batch
command to run "the same code your application uses, not a parallel implementation" and to need no
setup beyond install, so the API and the command line are both thin callers of one `packages/core`.

## Setup

Requires Node.js 22 or later (`.nvmrc` provided).

```bash
npm install
npm test          # all workspaces
npm run typecheck
```

_Pending — environment variables, running the app locally, the deployed URLs, and the exact
`npm run evaluate` commands are added when the batch entry point and the apps land._

## LLM provider and model

_Pending — written when the LLM layer lands, with the free-tier limits it was tuned against._

## Architecture

_Pending — diagram and module map are added once the API and web app exist. The working design is
in [`docs/DESIGN.md`](docs/DESIGN.md)._

## Retrieval approach and sources

_Pending — written with the fetcher and crawler._

## Research and generation steps

_Pending — written with the pipeline orchestrator._

## Kit structure

Every kit conforms to Appendix A of the brief. The contract lives in
[`packages/core/src/schema/kit.ts`](packages/core/src/schema/kit.ts) and is checked in two layers:

1. **Shape** — exact field names and enum spellings, `difficulty` an integer 1–3, `minutes` a
   positive integer, URLs restricted to http(s). Facts a job description may not state (`company`,
   `location`, `title`, `seniority`) may be empty strings; they are never guessed.
2. **Cross-references** — ids are unique, every `requirement_ids` and `question_ids` entry points at
   something that exists, and the schedule has exactly `days_available` days numbered 1..N.

A test compares the key paths of a parsed kit against Appendix A's literal sample, so a renamed or
missing field fails the build rather than the evaluation.

**Extensions are top-level keys only** (`warnings`, `research_log`, `hiring_process`,
`requirement_evidence`). Every object Appendix A defines keeps exactly the shape it was given —
adding a key inside `company_brief` or a question would risk a consumer that reads those objects
strictly. Unknown keys inside those objects are stripped on validation.

Requirement, question and flashcard ids (`r1`, `q1`, `f1`) are assigned by code, never by the
model, which is what makes them stable and makes coverage checkable.

The batch envelope from Appendix B is in
[`packages/core/src/schema/batch.ts`](packages/core/src/schema/batch.ts). `status` is a
discriminated union: an `ok` entry must carry a kit and a `failed` entry must carry an error.

## The second pass: coverage

[`packages/core/src/coverage/coverage.ts`](packages/core/src/coverage/coverage.ts)

Finding gaps is a set difference, so it is code: every requirement id that no question lists in
its `requirement_ids` is a gap. A question citing a requirement id that does not exist covers
nothing, so an invented id cannot pass as coverage.

**How many passes, and when to stop.** At most three coverage checks: one on the first draft and
one after each of up to two repair passes. A repair pass asks the model only for the requirements
that are still missing, which keeps it cheap and makes it converge.

- An uncovered **must-have** keeps the loop going until the cap.
- An uncovered **nice-to-have** gets exactly one repair attempt. A "bonus points for" line is worth
  a cheap try, not the token budget of a free tier.
- If a must-have survives two targeted attempts, the kit ships with it listed in
  `coverage.uncovered_requirement_ids`. Reporting the gap is better than looping until the provider
  rate-limits the run.

`coverage.passes` is the number of checks that ran, so a clean first draft reports `1`.

**Limitation:** the check trusts each question's `requirement_ids`. It proves every requirement has
a question pointing at it, not that the question is a good one.

## How the schedule is allocated

[`packages/core/src/scheduling/schedule.ts`](packages/core/src/scheduling/schedule.ts) — a pure
function of `(questions, requirements, days)`. No model is involved.

1. **Rank.** Weight = priority × difficulty, with must-have = 3, no linked requirement (typically
   company-fit) = 2, nice-to-have = 1. Ties go to the must-have, then to original order. Priority
   outweighs difficulty on purpose: priority comes from the posting's own wording, while difficulty
   is the model's estimate.
2. **Minutes.** Difficulty 1 / 2 / 3 → 10 / 15 / 25 minutes, so durations are integers by
   construction. Review days count half, rounded up. A day is capped at 480 minutes; the cap never
   drops a question.
3. **At least as many questions as days.** Every day gets one question and the remainder is shared
   in proportion to D, D−1, … 1 using largest-remainder rounding. The ranked list is cut into
   consecutive chunks of those sizes, so day 1 is the heaviest and hardest, the last day is the
   lightest, and every question is scheduled exactly once.
4. **More days than questions** (a 60-day plan for a dozen questions). One new question a day in
   rank order, then review days cycling three questions at a time, ending on a short recap of the
   top must-haves — a recap, not a cram.
5. **No questions** (a two-line job description). Still exactly N days, each labelled as company
   research. A thin description produces a thin kit that says so.
6. **Focus labels** are assembled in code from each day's categories and requirement texts.

The constants (minutes table, tier weights, daily cap) are named at the top of the file.

## Generated, edited and pinned state

_Pending — written with the builder API._

## Practice mode

_Pending._

## Long-running generation

_Pending — written with the job runner._

## Edge cases and failure handling

Decided so far:

- **`ok` versus `failed` in the batch output.** A case is `ok` whenever a kit could be produced,
  including a kit built from the job description alone because the company site was unreachable;
  the gap is recorded in the kit's `warnings` and the brief says plainly that nothing was
  retrieved. `failed` is reserved for a case where no kit could be produced at all. Appendix B's
  sample shows `COMPANY_UNREACHABLE` on a failed entry, but the FAQ's rule — "Reserve failed for a
  case you could not produce a kit for at all … a missing hiring page is not a failure" — is the
  one followed here.
- **A 1-day or 60-day schedule** — see [How the schedule is allocated](#how-the-schedule-is-allocated).
- **A job description with almost nothing to extract** — zero requirements is a valid kit: no
  questions, empty coverage, and a schedule of research days.
- **One malformed case in a batch file** is recorded as failed without rejecting the rest of the
  file; cases are parsed one at a time.

_Pending — unreachable and hiring-page-less sites, empty public discussion, invalid model output,
rate limiting, and duplicate submissions are written up as each is implemented._

## Security

Every outbound request goes through one function,
[`fetchPage`](packages/core/src/retrieval/fetch-page.ts), so the limits exist in exactly one place.

**Where it may connect** — [`url-guard.ts`](packages/core/src/retrieval/url-guard.ts). Only http
and https; no credentials embedded in the URL. Private, loopback, link-local (including the cloud
metadata address `169.254.169.254`), carrier-NAT, multicast and reserved ranges are rejected for
IPv4 and IPv6, whether the address is written literally, written in an alternative spelling
(`2130706433`, `0x7f.0.0.1`, `127.1`), or reached through DNS. If a name resolves to several
addresses, all of them must be public. The check runs again on **every redirect hop**, because a
public page can redirect to a private address.

The brief asks for private addresses to be rejected in production, and also serves the evaluation
sites from `localhost`. `allowPrivateHosts` is therefore an argument the caller passes in code,
not an environment variable: the batch command is a local operator tool and passes `true`; the
deployed API passes `false`. There is no flag for anyone to forget or mis-set.

**What it accepts** — one 10-second deadline per attempt covering redirects, headers and body; at
most 3 redirects; HTML, plain text and XML only; the body is streamed and cut off at 1.5 MB rather
than buffered, with the result flagged `truncated`.

**Failure is a value.** `fetchPage` never throws. A 404, a timeout or a blocked URL comes back as
`{ ok: false, code, message }`, which is what lets the pipeline skip and report one source instead
of failing the run. 429, 5xx, timeouts and network errors are retried up to 3 attempts with
exponential backoff and jitter, honouring `Retry-After`; a 404 is not retried.

**Known limitation:** the guard validates the addresses DNS returns, and the connection then
resolves the name again. A hostile DNS server could answer differently the second time (DNS
rebinding). Closing that gap means pinning the socket to the validated address, which was left out
of scope.

_Pending — treating fetched text as data rather than instructions is written with the LLM layer._

## Creative feature

_Pending._

## Design decisions, trade-offs and known limitations

- **Pipeline as a library, not part of the server.** Costs a workspace boundary; buys a batch
  command with no database and no drift between the app and the evaluated path.
- **Extensions at the top level only.** Slightly less convenient than annotating items in place;
  keeps every Appendix A object exactly the shape the brief gives it.
- **Coverage trusts `requirement_ids`.** See the limitation under
  [The second pass](#the-second-pass-coverage).
- **Difficulty is a model estimate.** The schedule's hard-first ordering is only as good as it is,
  which is why priority carries more weight.

_More are added as they are made._

## Tests

```bash
npm test
```

Tests need no API key and no database. Covered so far: kit and batch structure validation
(including cross-references and Appendix A key conformance), coverage checking and the pass-limit
rule, and schedule allocation for 1-day, N-day, 60-day and zero-question cases.

The scheduler is also property-tested: fast-check generates random requirements, questions and day
counts (1–90) and asserts that the schedule always spans exactly the requested days, uses positive
integer minutes within the cap, references only questions that exist, validates against the kit
schema, schedules every question, reaches every must-have that has a question, and introduces
material in rank order. Reversing the rank order or dropping a question from a day makes these
tests fail, which was checked by hand.
