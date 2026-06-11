/**
 * LUM-436: lift the jest-t.ts zero-match guard from the *test* layer up to the
 * *stored-contract* layer.
 *
 * Background. `scripts/jest-t.ts` already fails a MACHINE checkpointer the
 * moment its named test is renamed or deleted (zero match) — but only when the
 * checkpointer is RUN. A PASS recorded before the rename stays on the books;
 * the task sits in DONE and the drift is invisible until someone re-verifies.
 * The renaming often happens in a *different* task's work (the canonical case:
 * #528 renamed a test owned by LUM-433's contract), so bound-task re-verify
 * never re-runs it.
 *
 * This detector resolves a checkpointer STATICALLY — parse the `jest-t.ts
 * '<name>' <path>` form, confirm the path exists and still contains the test
 * name — so a stored contract can be swept for stale checkpointers without
 * running anything. Two invariants pinned here:
 *
 *  c1 — it classifies correctly: a checkpointer whose test was renamed/deleted
 *       (zero-match) is `drifted`; one that resolves to a real test is
 *       `healthy`. Offline + fixture-driven, no live API.
 *  c2 — it is detection-only: a sweep executes no checkpointer side effect,
 *       opens no network connection (no verdict POST, no verify round), and
 *       writes nothing. False-positive drift is worse than a miss, so the
 *       only thing it may do is read repo files.
 */
import { execFileSync } from 'node:child_process'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseJestTCheckpointer,
  classifyCheckpointer,
  sweepContracts,
  type CheckpointerCriterion,
} from '../scripts/checkpointer-drift'

const HEALTHY_NAME = 'sample healthy fixture test name'
const RENAMED_AWAY_NAME = 'sample test name that no longer exists'

/** A jest-t.ts checkpointer string for the given test name + file path. */
function jestT(name: string, path: string): string {
  return `npx tsx scripts/jest-t.ts '${name}' ${path}`
}

let repoRoot: string

beforeAll(() => {
  // A self-contained synthetic "repo" so the fixtures never depend on any other
  // file's test names (which would make this contract self-defeating — exactly
  // the drift class it guards against).
  repoRoot = mkdtempSync(join(tmpdir(), 'lum436-drift-'))
  mkdirSync(join(repoRoot, '__tests__'), { recursive: true })
  writeFileSync(
    join(repoRoot, '__tests__', 'sample.test.ts'),
    `describe('fixture', () => {\n  it('${HEALTHY_NAME}', () => {\n    expect(1).toBe(1)\n  })\n})\n`,
    'utf8'
  )
})

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

describe('LUM-436 checkpointer drift', () => {
  it('checkpointer drift check flags zero-match checkpointers and clears resolvable ones', () => {
    const healthy: CheckpointerCriterion = {
      id: 'c-healthy',
      verifierType: 'MACHINE',
      checkpointer: jestT(HEALTHY_NAME, '__tests__/sample.test.ts'),
    }
    // Test file still exists, but the named test was renamed away → zero match.
    const renamed: CheckpointerCriterion = {
      id: 'c-renamed',
      verifierType: 'MACHINE',
      checkpointer: jestT(RENAMED_AWAY_NAME, '__tests__/sample.test.ts'),
    }
    // The whole test file was deleted/moved → path no longer resolves.
    const deleted: CheckpointerCriterion = {
      id: 'c-deleted',
      verifierType: 'MACHINE',
      checkpointer: jestT(HEALTHY_NAME, '__tests__/gone.test.ts'),
    }
    // Non jest-t.ts checkpointer: not statically resolvable → never drifted.
    const unparseable: CheckpointerCriterion = {
      id: 'c-bash',
      verifierType: 'MACHINE',
      checkpointer:
        'bash -c "test -z \\"$(git diff --name-only origin/main)\\""',
    }
    // HUMAN criterion has no checkpointer → nothing to resolve.
    const human: CheckpointerCriterion = {
      id: 'c-human',
      verifierType: 'HUMAN',
      checkpointer: null,
    }

    expect(classifyCheckpointer(healthy, repoRoot).status).toBe('healthy')
    expect(classifyCheckpointer(renamed, repoRoot).status).toBe('drifted')
    expect(classifyCheckpointer(deleted, repoRoot).status).toBe('drifted')
    expect(classifyCheckpointer(unparseable, repoRoot).status).toBe('skipped')
    expect(classifyCheckpointer(human, repoRoot).status).toBe('skipped')

    // The parser underpins the classification: it recovers name + path from the
    // prescribed form and rejects everything else (so non-jest forms can never
    // be mis-flagged as drift).
    const parsed = parseJestTCheckpointer(
      jestT(HEALTHY_NAME, '__tests__/sample.test.ts')
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe(HEALTHY_NAME)
    expect(parsed!.paths).toEqual(['__tests__/sample.test.ts'])
    expect(parseJestTCheckpointer('npx jest -t "x"')).toBeNull()

    // A sweep groups across a whole contract.
    const report = sweepContracts(
      [
        {
          taskIdentifier: 'LUM-FIXTURE',
          criteria: [healthy, renamed, deleted, unparseable, human],
        },
      ],
      repoRoot
    )
    expect(report.drifted.map(d => d.criterionId).sort()).toEqual([
      'c-deleted',
      'c-renamed',
    ])
    expect(report.healthy.map(d => d.criterionId)).toEqual(['c-healthy'])
    expect(report.skipped.map(d => d.criterionId).sort()).toEqual([
      'c-bash',
      'c-human',
    ])
  })

  it('checkpointer drift check is detection-only and writes no verdict', () => {
    const criteria: CheckpointerCriterion[] = [
      {
        id: 'c-healthy',
        verifierType: 'MACHINE',
        checkpointer: jestT(HEALTHY_NAME, '__tests__/sample.test.ts'),
      },
      {
        id: 'c-renamed',
        verifierType: 'MACHINE',
        checkpointer: jestT(RENAMED_AWAY_NAME, '__tests__/sample.test.ts'),
      },
    ]

    // Spy on every side-effecting surface the detector must never touch:
    //  - child_process.* : running a checkpointer (a verify round) is forbidden
    //  - global.fetch     : a verdict POST / round advance would be a network write
    //  - fs writes        : detection reads, it never persists
    const execSpies = [
      jest.spyOn(childProcess, 'execFileSync'),
      jest.spyOn(childProcess, 'execSync'),
      jest.spyOn(childProcess, 'spawnSync'),
      jest.spyOn(childProcess, 'spawn'),
    ]
    const writeSpies = [
      jest.spyOn(fs, 'writeFileSync'),
      jest.spyOn(fs, 'appendFileSync'),
    ]
    // `fetch` may be absent under jsdom, so swap it manually (jest.spyOn needs
    // an existing property). Any call would be a network write — fail loudly.
    const originalFetch = (globalThis as { fetch?: unknown }).fetch
    let fetchCalls = 0
    ;(globalThis as { fetch?: unknown }).fetch = () => {
      fetchCalls++
      throw new Error('detection must not open a network connection')
    }

    let report
    try {
      report = sweepContracts(
        [{ taskIdentifier: 'LUM-FIXTURE', criteria }],
        repoRoot
      )
    } finally {
      execSpies.forEach(s => s.mockRestore())
      writeSpies.forEach(s => s.mockRestore())
      ;(globalThis as { fetch?: unknown }).fetch = originalFetch
    }

    // The sweep still produced a real verdict (not vacuously side-effect-free
    // because it crashed early).
    expect(report.healthy).toHaveLength(1)
    expect(report.drifted).toHaveLength(1)

    for (const s of [...execSpies, ...writeSpies]) {
      expect(s).not.toHaveBeenCalled()
    }
    expect(fetchCalls).toBe(0)

    // And the result is a read-only classification — no verdict / write fields
    // leak into the report shape.
    const sample = report.drifted[0]!
    expect(Object.keys(sample).sort()).toEqual(
      [
        'criterionId',
        'reason',
        'status',
        'statement',
        'taskIdentifier',
        'testName',
        'testPaths',
      ].sort()
    )
    expect(sample.status).toBe('drifted')
  })
})

// Touch the import so lint doesn't flag it; the c2 test exercises execFileSync's
// spy, this keeps the symbol referenced if that test is ever trimmed.
void execFileSync
