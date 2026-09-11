/** @jest-environment node */
// LUM-762: huntAudit was write-only — no API, no UI, triage meant reading
// Vercel logs. This is the read side: a defensive parse of the raw Json
// column into "which categories ran, how long did each take".
import { parseHuntCoverage } from '@/lib/security-scan/hunt/coverage'
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
      categories: [
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

  it('collapses a retried category to its final attempt and counts the attempts', () => {
    const coverage = parseHuntCoverage({
      categories: [
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

  it('keeps the run order of HUNT_CATEGORIES regardless of row order', () => {
    const coverage = parseHuntCoverage({
      categories: [row({ category: 'logic' }), row({ category: 'idor' })],
    })
    expect(coverage!.categories.map(c => c.category)).toEqual(['idor', 'logic'])
  })

  it('returns null for an absent, legacy or unusable audit instead of throwing', () => {
    expect(parseHuntCoverage(null)).toBeNull()
    expect(parseHuntCoverage(undefined)).toBeNull()
    expect(parseHuntCoverage('{}')).toBeNull()
    expect(parseHuntCoverage(42)).toBeNull()
    expect(parseHuntCoverage([])).toBeNull()
    // LUM-739-era rows: an audit that only carries the failure reason.
    expect(parseHuntCoverage({ error: 'GitHub 502' })).toBeNull()
    expect(parseHuntCoverage({ categories: [] })).toBeNull()
    expect(parseHuntCoverage({ categories: 'nope' })).toBeNull()
  })

  it('drops rows it cannot vouch for and repairs unusable numbers', () => {
    const coverage = parseHuntCoverage({
      categories: [
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
})
