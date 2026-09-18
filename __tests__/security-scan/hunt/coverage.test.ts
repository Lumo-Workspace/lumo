/** @jest-environment node */
// LUM-762: huntAudit was write-only — no API, no UI, triage meant reading
// Vercel logs. This is the read side: a defensive parse of the raw Json
// column into "which categories ran, how long did each take".
import {
  formatHuntCoverage,
  parseHuntCoverage,
} from '@/lib/security-scan/hunt/coverage'
import { HUNT_CATEGORIES } from '@/lib/services/security-hunt.config'

const row = (over: Record<string, unknown> = {}) => ({
  category: 'idor',
  candidates: 2,
  tokens: 1200,
  elapsedMs: 41_000,
  stopped: 'done',
  ...over,
})

describe('LUM-762 hunt coverage', () => {
  it('reports each category outcome and how long it took', () => {
    const coverage = parseHuntCoverage({
      tasks: [
        row(),
        row({ category: 'injection', stopped: 'timeout', elapsedMs: 60_000 }),
        row({ category: 'ssrf', stopped: 'skipped', elapsedMs: 0, tokens: 0 }),
      ],
    })
    expect(coverage).not.toBeNull()
    expect(coverage!.total).toBe(HUNT_CATEGORIES.length)
    expect(coverage!.done).toBe(1)
    expect(coverage!.categories).toEqual([
      {
        category: 'idor',
        stopped: 'done',
        elapsedMs: 41_000,
        tokens: 1200,
        candidates: 2,
        attempts: 1,
      },
      {
        category: 'injection',
        stopped: 'timeout',
        elapsedMs: 60_000,
        tokens: 1200,
        candidates: 2,
        attempts: 1,
      },
      {
        category: 'ssrf',
        stopped: 'skipped',
        elapsedMs: 0,
        tokens: 0,
        candidates: 2,
        attempts: 1,
      },
    ])
  })

  it('collapses a retried pre-task-graph category row to its final attempt and counts the attempts', () => {
    const coverage = parseHuntCoverage({
      tasks: [
        row({ stopped: 'timeout', elapsedMs: 60_000, tokens: 0 }),
        row({ stopped: 'done', elapsedMs: 12_000, tokens: 900 }),
      ],
    })
    expect(coverage!.categories).toEqual([
      {
        category: 'idor',
        stopped: 'done',
        elapsedMs: 72_000,
        tokens: 900,
        candidates: 2,
        attempts: 2,
      },
    ])
    expect(coverage!.done).toBe(1)
  })

  it('reports rows in the order the workflow attempted them', () => {
    // LUM-758: the audit is written in attempt order, which is plan order —
    // that is the order a human wants to read the layer back in, and with a
    // task graph there is no HUNT_CATEGORIES order to fall back on.
    const coverage = parseHuntCoverage({
      tasks: [row({ category: 'logic' }), row({ category: 'idor' })],
    })
    expect(coverage!.categories.map(c => c.category)).toEqual(['logic', 'idor'])
  })

  it('LUM-758 keeps two tasks of the SAME category apart instead of folding them into one retried row', () => {
    const coverage = parseHuntCoverage({
      planned: [
        { id: 't1', objective: 'a', category: 'injection', startingPoints: [] },
        { id: 't2', objective: 'b', category: 'injection', startingPoints: [] },
      ],
      tasks: [
        row({
          taskId: 't1',
          objective: 'raw SQL in lib/db.ts',
          category: 'injection',
          elapsedMs: 41_000,
        }),
        row({
          taskId: 't2',
          objective: 'child_process on a request path',
          category: 'injection',
          elapsedMs: 12_000,
        }),
      ],
    })
    expect(coverage!.categories).toHaveLength(2)
    expect(coverage!.categories.map(c => c.taskId)).toEqual(['t1', 't2'])
    expect(coverage!.categories.map(c => c.objective)).toEqual([
      'raw SQL in lib/db.ts',
      'child_process on a request path',
    ])
    // Neither is a retry of the other, and both count toward `done`, so a
    // fully-run layer reads 2/2 rather than 1/2.
    expect(coverage!.categories.every(c => c.attempts === 1)).toBe(true)
    expect(coverage!.done).toBe(2)
    expect(coverage!.total).toBe(2)
  })

  it('LUM-758 still collapses the SAME task re-run by the retry pass', () => {
    const coverage = parseHuntCoverage({
      planned: [
        { id: 't1', objective: 'a', category: 'injection', startingPoints: [] },
      ],
      tasks: [
        row({
          taskId: 't1',
          category: 'injection',
          stopped: 'timeout',
          elapsedMs: 60_000,
          // Non-zero on BOTH attempts on purpose: the first attempt burned
          // tokens before it timed out, and `tokens` is what the task cost
          // the scan, so the row must add them up. With a 0 here the sum and
          // the last attempt are the same number and neither is tested.
          tokens: 400,
        }),
        row({
          taskId: 't1',
          category: 'injection',
          stopped: 'done',
          elapsedMs: 12_000,
          tokens: 900,
        }),
      ],
    })
    expect(coverage!.categories).toHaveLength(1)
    expect(coverage!.categories[0]).toMatchObject({
      taskId: 't1',
      // `stopped` and `candidates` are the LAST attempt's — a retry replaces
      // the outcome. `elapsedMs` and `tokens` are what the task cost, summed.
      stopped: 'done',
      elapsedMs: 72_000,
      tokens: 1300,
      candidates: 2,
      attempts: 2,
    })
    expect(coverage!.done).toBe(1)
    expect(coverage!.total).toBe(1)
  })

  it('returns null for an absent, legacy or unusable audit instead of throwing', () => {
    expect(parseHuntCoverage(null)).toBeNull()
    expect(parseHuntCoverage(undefined)).toBeNull()
    expect(parseHuntCoverage('{}')).toBeNull()
    expect(parseHuntCoverage(42)).toBeNull()
    expect(parseHuntCoverage([])).toBeNull()
    // LUM-739-era rows: an audit that only carries the failure reason.
    expect(parseHuntCoverage({ error: 'GitHub 502' })).toBeNull()
    expect(parseHuntCoverage({ tasks: [] })).toBeNull()
    expect(parseHuntCoverage({ tasks: 'nope' })).toBeNull()
  })

  it('LUM-758: total is the planned count, not HUNT_CATEGORIES.length', () => {
    const coverage = parseHuntCoverage({
      // `planned` holds `HuntTask` objects post-task-graph; `total` only
      // cares about the array length, not the shape of its entries.
      planned: [
        {
          id: 't1',
          objective: 'check idor path',
          category: 'idor',
          startingPoints: [],
        },
        {
          id: 't2',
          objective: 'check injection path',
          category: 'injection',
          startingPoints: [],
        },
      ],
      tasks: [
        row({ category: 'idor' }),
        row({ category: 'injection', stopped: 'done' }),
      ],
    })
    expect(coverage!.total).toBe(2)
    expect(coverage!.done).toBe(2)
  })

  it('falls back to HUNT_CATEGORIES.length when the row predates `planned` (pre-LUM-758)', () => {
    const coverage = parseHuntCoverage({
      tasks: [row(), row({ category: 'injection' })],
    })
    expect(coverage!.total).toBe(HUNT_CATEGORIES.length)
  })

  it('reads a pre-Task-13 row that still uses the `categories` field name', () => {
    // Task 13 renamed `HuntAudit.categories` to `.tasks`; rows persisted
    // before that rename must keep rendering rather than silently losing
    // their coverage line.
    const coverage = parseHuntCoverage({
      categories: [row(), row({ category: 'injection', stopped: 'timeout' })],
    })
    expect(coverage).not.toBeNull()
    expect(coverage!.total).toBe(HUNT_CATEGORIES.length)
    expect(coverage!.categories.map(c => c.category)).toEqual([
      'idor',
      'injection',
    ])
    // No taskId on such a row — the field stays absent rather than inventing one.
    expect(coverage!.categories.every(c => c.taskId === undefined)).toBe(true)
  })

  it('drops rows it cannot vouch for and repairs unusable numbers', () => {
    const coverage = parseHuntCoverage({
      tasks: [
        row({ category: 'not_a_category' }),
        row({ category: 'race', stopped: 'exploded' }),
        null,
        'idor',
        row({
          category: 'logic',
          elapsedMs: -5,
          tokens: 'lots',
          candidates: NaN,
        }),
      ],
    })
    expect(coverage!.categories).toEqual([
      {
        category: 'logic',
        stopped: 'done',
        elapsedMs: 0,
        tokens: 0,
        candidates: 0,
        attempts: 1,
      },
    ])
  })

  // LUM-787 follow-up — a diff past the size the top tier can cover is said
  // so on the line, whatever the tasks' stops read.
  it('LUM-787 follow-up: an oversized diff is parsed and printed as partial coverage', () => {
    const raw = {
      planned: [{ id: 't1' }],
      tasks: [
        {
          taskId: 't1',
          category: 'injection',
          stopped: 'done',
          elapsedMs: 1000,
          tokens: 10,
          candidates: 0,
        },
      ],
      diff: { sourceFiles: 57, sites: 12, taskCap: 5, oversized: true },
    }
    const coverage = parseHuntCoverage(raw)!
    expect(coverage.oversized).toEqual({ sourceFiles: 57 })
    expect(formatHuntCoverage(coverage)).toBe(
      '1/1 done · t1 injection 1.0s done · oversized (57 source files, partial coverage)'
    )
    // Not oversized, or written before the field existed: nothing added.
    const small = parseHuntCoverage({
      ...raw,
      diff: { ...raw.diff, oversized: false },
    })!
    expect(small.oversized).toBeUndefined()
    expect(formatHuntCoverage(small)).toBe('1/1 done · t1 injection 1.0s done')
    const older = parseHuntCoverage({ planned: raw.planned, tasks: raw.tasks })!
    expect(older.oversized).toBeUndefined()
  })

  it('LUM-799 no-progress rows survive the stop vocabulary', () => {
    // A stop value this parse does not know is dropped, row and all — so a
    // task stopped for looping would leave the coverage line reading as if it
    // had never been planned.
    const coverage = parseHuntCoverage({
      planned: [{ id: 't1' }, { id: 't2' }],
      tasks: [
        row({ taskId: 't1', stopped: 'done' }),
        row({ taskId: 't2', stopped: 'no-progress', category: 'injection' }),
      ],
    })
    expect(coverage!.categories.map(c => c.stopped)).toEqual([
      'done',
      'no-progress',
    ])
    expect(coverage!.done).toBe(1)
    expect(formatHuntCoverage(coverage!)).toContain('no-progress')
  })
})
