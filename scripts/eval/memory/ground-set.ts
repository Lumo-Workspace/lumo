import type { MemoryCategory } from '@prisma/client'

/**
 * LUM-396 grounding eval corpus — quote-or-discard interception cases.
 *
 * DELIBERATELY SEPARATE from `eval-set.ts`: grounding judges candidate-vs-
 * source-material support, which needs no embeddings, so these cases are NOT
 * embedded by fixture-gen.ts and `vectors.fixture.json` never has to be
 * regenerated when a case is added here (the LUM-336 lesson: appending to
 * `evalSet` without regenerating the fixture turns the frozen AR tests red).
 *
 * Each case mirrors one real grounding batch: a source text (L1 compacted
 * turn log or L2 task-memory window) plus the candidate list one extract pass
 * could plausibly emit for it. `expected` is the annotation:
 * - SUPPORTED   — the candidate's core claim is present in the source
 *                 (paraphrase allowed); grounding must KEEP it.
 * - UNSUPPORTED — 无依据推断: the candidate asserts a cause, rule, decision,
 *                 or fix the source never states; grounding must DISCARD it.
 */

export type GroundExpectation = 'SUPPORTED' | 'UNSUPPORTED'

export interface GroundEvalCandidate {
  category: MemoryCategory
  /** Per-category content shape from lib/memory/schemas.ts. */
  content: unknown
  expected: GroundExpectation
  /** Annotator rationale — never fed to the model. */
  note?: string
}

export interface GroundEvalCase {
  id: string
  /** 'L1' = compacted turn event log, 'L2' = task-memory window. */
  layerShape: 'L1' | 'L2'
  sourceText: string
  candidates: GroundEvalCandidate[]
}

export const groundEvalSet: GroundEvalCase[] = [
  {
    id: 'ground-l1-migration',
    layerShape: 'L1',
    sourceText: [
      '[10:02:11] Bash "npx prisma migrate dev --name add_status" ERR — stderr: P3009: failed migrations found. ALTER TYPE ... ADD VALUE cannot run inside a transaction with a statement that reads the new value',
      '[10:03:40] Write prisma/migrations/20260610_add_status_value/migration.sql (4 lines)',
      '[10:04:02] Bash "npx prisma migrate dev" OK',
      '[10:05:10] Bash "npx prisma migrate dev --name use_status_default" OK',
      '[turn end] "Split it into two migrations: first ADD VALUE only, then the column default that reads it."',
    ].join('\n'),
    candidates: [
      {
        category: 'TRAP',
        content: {
          summary: 'Enum value + use in one migration fails',
          trigger: 'Add a Postgres enum value and read it in the same migration.',
          outcome: 'P3009 — ALTER TYPE ADD VALUE cannot share a transaction with a statement reading the new value.',
        },
        expected: 'SUPPORTED',
        note: 'Paraphrase of the stderr + the turn-end note.',
      },
      {
        category: 'PROCEDURAL',
        content: {
          summary: 'Add a Postgres enum value safely',
          workflow: 'Add a new Postgres enum value used by a later change',
          trigger: 'Adding an enum value you need to use in the same change.',
          steps: ['Migration 1: ADD VALUE only.', 'Migration 2: the default/backfill that reads it.'],
        },
        expected: 'SUPPORTED',
        note: 'The two-migration split is what the turn actually did.',
      },
      {
        category: 'TRAP',
        content: {
          summary: 'Neon pooled connections break migrate dev',
          trigger: 'Run prisma migrate dev through the Neon pooled connection string.',
          outcome: 'Migrations intermittently fail; use the direct (unpooled) URL instead.',
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — invented cause: nothing in the turn mentions Neon or pooling.',
      },
    ],
  },
  {
    id: 'ground-l1-flaky-test',
    layerShape: 'L1',
    sourceText: [
      '[14:20:05] Bash "npx jest __tests__/lib/services/notify.test.ts" ERR — 1 failed: expected 2 calls, received 3',
      '[14:21:33] Read lib/services/notify.service.ts (180 lines)',
      '[14:24:01] Bash "npx jest __tests__/lib/services/notify.test.ts" OK',
      '[turn end] "The retry queue double-fires when the first attempt resolves after the timeout window — clamped the timer in the test."',
    ].join('\n'),
    candidates: [
      {
        category: 'TRAP',
        content: {
          summary: 'Retry queue double-fires past the timeout window',
          trigger: 'First notify attempt resolves after the retry timeout window.',
          outcome: 'The retry fires anyway → handler runs twice (test saw 3 calls, not 2).',
        },
        expected: 'SUPPORTED',
      },
      {
        category: 'DECISION',
        content: {
          summary: 'Notifications move to a Kafka outbox',
          what: 'Chose a Kafka-backed outbox over in-process retries for notifications.',
          why: 'In-process retries double-fire and lose events on deploy.',
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — invented decision: the turn fixed a test, no outbox/Kafka discussion.',
      },
      {
        category: 'TRAP',
        content: {
          summary: 'jest fake timers leak between notify tests',
          trigger: 'Run the notify suite with fake timers enabled in a previous test file.',
          outcome: 'Timers leak across files and the retry assertion flakes.',
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — plausible-sounding alternative cause never stated in the source.',
      },
    ],
  },
  {
    id: 'ground-l1-user-rule',
    layerShape: 'L1',
    sourceText: [
      '[09:10:00] Edit lib/validation/org-invite.ts (+24 lines)',
      '[turn end] "Per user: \'all new request schemas must use Zod, stop hand-rolling validators\' — rewrote OrgInvite with a zod schema."',
    ].join('\n'),
    candidates: [
      {
        category: 'CONVENTION',
        content: {
          summary: 'New request schemas use Zod',
          rule: 'New request schemas use Zod, not hand-rolled validators.',
          scope: 'All new request schemas; existing ones migrate opportunistically.',
        },
        expected: 'SUPPORTED',
      },
      {
        category: 'CONVENTION',
        content: {
          summary: 'API routes require rate limiting',
          rule: 'Every new API route must ship with a rate limiter.',
          scope: 'All app/api routes.',
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — invented rule: the user only spoke about Zod schemas.',
      },
    ],
  },
  {
    id: 'ground-l1-invented-workaround',
    layerShape: 'L1',
    sourceText: [
      '[16:40:12] Bash "npm run build" ERR — Module not found: @lumo/shared/dist/errors',
      '[16:41:05] Read package.json (90 lines)',
      '[turn end] "Vercel build breaks because shared/dist is gitignored and nothing builds it before next build. Left it failing — need to decide where the build step lives."',
    ].join('\n'),
    candidates: [
      {
        category: 'TRAP',
        content: {
          summary: 'shared/dist gitignored, Vercel build breaks',
          trigger: 'Import @lumo/shared from app code and deploy to Vercel.',
          outcome: 'Module not found — shared/dist is gitignored and nothing builds it before next build.',
        },
        expected: 'SUPPORTED',
      },
      {
        category: 'TRAP',
        content: {
          summary: 'shared/dist gitignored, Vercel build breaks',
          trigger: 'Import @lumo/shared from app code and deploy to Vercel.',
          outcome: 'Module not found — shared/dist is gitignored.',
          workaround: 'Add a prebuild script that runs build:shared before next build.',
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — invented fix presented as done: the turn explicitly left it unresolved.',
      },
    ],
  },
  {
    id: 'ground-l2-recurring-trap',
    layerShape: 'L2',
    sourceText: [
      '  task=task_a (1 memories):',
      '    - id=mem_1 category=TRAP content={"trigger":"Add a Postgres enum value and use it in the same Prisma migration.","outcome":"P3009 — Postgres won\'t alter an enum and read the new value in one transaction."}',
      '  task=task_b (2 memories):',
      '    - id=mem_2 category=TRAP content={"trigger":"Adding a status to the order enum and defaulting a column to it in one migration.","outcome":"Same P3009 enum-mid-migration failure on a different feature."}',
      '    - id=mem_3 category=DECISION content={"what":"Split the OAuth PR into two commits.","why":"Reviewers asked for an easier diff."}',
    ].join('\n'),
    candidates: [
      {
        category: 'TRAP',
        content: {
          summary: 'Enum value + use in one migration fails',
          trigger: 'Add a Postgres enum value and use it in the same Prisma migration.',
          outcome: 'P3009 — Postgres won\'t alter an enum and read the new value in one transaction.',
        },
        expected: 'SUPPORTED',
        note: 'Recurs in mem_1 + mem_2.',
      },
      {
        category: 'CONVENTION',
        content: {
          summary: 'Schema changes need a second reviewer',
          rule: 'Every migration PR needs sign-off from a second reviewer.',
          scope: 'All schema-change PRs.',
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — no source memory mentions review requirements.',
      },
      {
        category: 'PROCEDURAL',
        content: {
          summary: 'Recover a failed prod migration',
          workflow: 'Roll back a failed production migration',
          trigger: 'A migration fails on prod.',
          steps: ['Restore the Neon branch snapshot.', 'Re-run migrate deploy.'],
        },
        expected: 'UNSUPPORTED',
        note: '无依据推断 — invented multi-step procedure; sources never touch prod recovery.',
      },
    ],
  },
]

/** Return human-readable problems with the corpus ([] = valid). */
export function validateGroundEvalSet(cases: GroundEvalCase[]): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const c of cases) {
    if (!c.id) errs.push('(missing id)')
    if (seen.has(c.id)) errs.push(`${c.id}: duplicate id`)
    seen.add(c.id)
    if (!c.sourceText.trim()) errs.push(`${c.id}: empty sourceText`)
    if (c.candidates.length === 0) errs.push(`${c.id}: no candidates`)
    c.candidates.forEach((cand, i) => {
      if (cand.content === null || typeof cand.content !== 'object') {
        errs.push(`${c.id}[${i}]: content not an object`)
      }
      if (cand.expected !== 'SUPPORTED' && cand.expected !== 'UNSUPPORTED') {
        errs.push(`${c.id}[${i}]: bad expected value`)
      }
    })
  }
  const unsupported = cases.flatMap(c => c.candidates).filter(x => x.expected === 'UNSUPPORTED')
  if (unsupported.length === 0) {
    errs.push('corpus has no UNSUPPORTED (hallucination) candidates — the interception eval would be vacuous')
  }
  return errs
}
