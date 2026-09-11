/** @jest-environment node */
// LUM-758 §11.2 — the design's load-bearing invariant: a `HuntTask`'s
// `objective` is open vocabulary, but the finding it produces is always
// typed by one of the closed `HUNT_CATEGORIES`, and `huntFingerprint` never
// hashes task identity. That's what lets `inheritDispositions` carry a
// human's "ignore this one" call across scans even though the plan that
// found it can phrase its objective differently next time.
// `security-hunt.service.ts` statically imports `lib/integrations/github/
// contents`, which pulls in `@octokit/auth-app` (ESM-only) transitively —
// stub both so this suite can statically import `toHuntFindingRows` without
// tripping jest's "Cannot use import statement outside a module" (same
// pattern as `__tests__/security-hunt.service.test.ts`).
jest.mock('@/lib/integrations/github/auth', () => ({}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  readRepoFile: jest.fn(),
}))

import { toHuntFindingRows } from '@/lib/services/security-hunt.service'
import {
  huntFingerprint,
  HUNT_CATEGORIES,
} from '@/lib/security-scan/hunt/candidate'
import { mechanicalVerify } from '@/lib/security-scan/hunt/mechanical-verify'
import type { HuntTask } from '@/lib/services/security-hunt.config'
import type { Subgraph } from '@/lib/security-scan/graph/types'
import type { HuntFindingInput } from '@/lib/services/security-hunt.config'

const candidate = (category: string) => ({
  category,
  claim: 'c',
  precondition: 'p',
  severity: 'HIGH' as const,
  cwe: 'CWE-89',
  reachability: 'DIRECT' as const,
  entry: { symbol: 'a.ts#GET', file: 'a.ts', line: 1 },
  sink: { symbol: 'b.ts#q', file: 'b.ts', line: 2 },
  call_chain: [{ from: 'a.ts#GET', to: 'b.ts#q' }],
  fingerprint: huntFingerprint(category, 'b.ts#q', 'a.ts#GET'),
  falsifierReason: 'r',
})

it('task objectives are open vocabulary but finding taxonomy and fingerprints stay closed', () => {
  for (const category of HUNT_CATEGORIES) {
    const [row] = toHuntFindingRows('s1', [candidate(category) as never])
    expect(row!.ruleId).toBe(`hunt:${category}`)
    expect(HUNT_CATEGORIES).toContain(row!.ruleId.slice('hunt:'.length))
  }

  // The regression this locks: someone threads a task's `id`/`objective`
  // into fingerprinting. Drive the real path — `mechanicalVerify` (where
  // `fingerprint` is set) then `toHuntFindingRows` — for two `HuntTask`s
  // that differ in `id` and `objective` but agree on `category`, and prove
  // the same real-world candidate (same sink, same entry) still comes out
  // with the same fingerprint and ruleId either way. If a future change
  // makes fingerprinting task-aware, this fails: a human's earlier
  // "dismiss" on this finding would stop applying the moment the plan
  // rephrases the task that rediscovers it.
  const subgraph: Subgraph = {
    symbols: [
      {
        id: 'a.ts#GET',
        kind: 'entry',
        file: 'a.ts',
        line: 1,
        name: 'GET',
        rule: null,
        controls: [],
      },
      {
        id: 'b.ts#q',
        kind: 'sink',
        file: 'b.ts',
        line: 2,
        name: 'q',
        rule: null,
        controls: [],
      },
    ],
    edges: [{ from: 'a.ts#GET', to: 'b.ts#q' }],
    files: [
      { path: 'a.ts', lineCount: 10, touched: true },
      { path: 'b.ts', lineCount: 10, touched: true },
    ],
  }

  const task1: HuntTask = {
    id: 't1',
    objective: 'check the query param reaches the SQL builder unescaped',
    category: 'injection',
    startingPoints: ['a.ts#GET'],
  }
  const task2: HuntTask = {
    id: 't2',
    objective: 'audit the search handler for string-built SQL',
    category: 'injection',
    startingPoints: ['a.ts#GET'],
  }

  // Same real-world candidate (same sink/entry) as it would be reported
  // under each task — only the free-text fields track the task's own
  // objective, the way a model's phrasing would vary in production.
  const rawCandidateFor = (task: HuntTask) => ({
    category: task.category,
    cwe: 'CWE-89',
    severity: 'HIGH' as const,
    sink: { symbol: 'b.ts#q', file: 'b.ts', line: 2 },
    entry: { symbol: 'a.ts#GET', file: 'a.ts', line: 1 },
    call_chain: [{ from: 'a.ts#GET', to: 'b.ts#q' }],
    precondition: `precondition found while pursuing "${task.objective}"`,
    claim: `claim from task ${task.id}: ${task.objective}`,
  })

  const result1 = mechanicalVerify(subgraph, [rawCandidateFor(task1)])
  const result2 = mechanicalVerify(subgraph, [rawCandidateFor(task2)])

  // Guard the premise: both must actually have been accepted, or the
  // fingerprint assertions below would vacuously pass over empty arrays.
  expect(result1.rejected).toEqual([])
  expect(result2.rejected).toEqual([])
  expect(result1.accepted).toHaveLength(1)
  expect(result2.accepted).toHaveLength(1)

  expect(result1.accepted[0]!.fingerprint).toBe(
    result2.accepted[0]!.fingerprint
  )

  const finding1: HuntFindingInput = {
    ...result1.accepted[0]!,
    falsifierReason: 'inconclusive',
  }
  const finding2: HuntFindingInput = {
    ...result2.accepted[0]!,
    falsifierReason: 'inconclusive',
  }
  const [row1] = toHuntFindingRows('s1', [finding1])
  const [row2] = toHuntFindingRows('s1', [finding2])

  expect(row1!.fingerprint).toBe(row2!.fingerprint)
  expect(row1!.ruleId).toBe(row2!.ruleId)
})
