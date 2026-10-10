/**
 * LUM-449 — read-only false-positive-rate measurement for boundary crossings.
 *
 * Phase 1-② of the agent-supervision moat: the dev-guardrail wedge only
 * survives if it is LOW-noise (a false-positive-heavy detector gets switched
 * off). This measures the false-positive rate per category from HUMAN
 * dispositions (LUM-435: FALSE_POSITIVE vs CONFIRMED), honestly handling the
 * sparse data of a freshly-launched feature, and never writing a thing
 * (mirrors the LUM-436 read-only sweep).
 *
 * The three `it(...)` names below are the literal MACHINE checkpointers on the
 * task contract — do not rename without updating the criteria.
 */
import {
  computeFalsePositiveRates,
  DEFAULT_MIN_SAMPLES,
  type DispositionedCrossing,
  formatReport,
} from '@/ee/private/boundary-crossing/false-positive-rate'

// Spied prisma surface for the read-only proof (criterion 3). Reads return
// fixtures; every write method is a jest.fn() we assert was never called.
const findMany = jest.fn()
const writeMethods = {
  create: jest.fn(),
  createMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  upsert: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
}
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: (...a: unknown[]) => findMany(...a),
      ...writeMethods,
    },
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('boundary-crossing false-positive rate (LUM-449)', () => {
  it('false-positive rate per category is computed from dispositions', () => {
    // Two categories with enough dispositions to report a rate honestly.
    const crossings: DispositionedCrossing[] = [
      // TEST_TAMPERING: 9 false-positive, 3 confirmed → 0.75 FP rate.
      ...rep('TEST_TAMPERING', 'FALSE_POSITIVE', 9),
      ...rep('TEST_TAMPERING', 'CONFIRMED', 3),
      // DESTRUCTIVE_DB_COMMAND: 0 false-positive, 10 confirmed → 0.0 FP rate
      // (a 0% rate is legitimate when the sample is sufficient).
      ...rep('DESTRUCTIVE_DB_COMMAND', 'CONFIRMED', 10),
    ]

    const report = computeFalsePositiveRates(crossings, { minSamples: 10 })

    const tamper = byCategory(report, 'TEST_TAMPERING')
    expect(tamper.status).toBe('measured')
    expect(tamper.dispositioned).toBe(12)
    expect(tamper.falsePositives).toBe(9)
    expect(tamper.confirmed).toBe(3)
    expect(tamper.falsePositiveRate).toBeCloseTo(0.75, 10)

    const db = byCategory(report, 'DESTRUCTIVE_DB_COMMAND')
    expect(db.status).toBe('measured')
    expect(db.dispositioned).toBe(10)
    expect(db.falsePositives).toBe(0)
    expect(db.falsePositiveRate).toBe(0)
  })

  it('categories below the sample threshold report insufficient data not a misleading rate', () => {
    // A sparse category whose only dispositions are FALSE_POSITIVE would read
    // as a screaming 100% FP rate — exactly the misleading number to suppress.
    // Another sparse category with only CONFIRMED would read as a reassuring
    // 0%. Both must come back as 'insufficient', rate null.
    const crossings: DispositionedCrossing[] = [
      ...rep('NEW_NPM_DEPENDENCY', 'FALSE_POSITIVE', 2), // naive: 100%
      ...rep('HARDCODED_SECRET', 'CONFIRMED', 1), // naive: 0%
    ]

    const report = computeFalsePositiveRates(crossings, { minSamples: 5 })

    const npm = byCategory(report, 'NEW_NPM_DEPENDENCY')
    expect(npm.status).toBe('insufficient')
    expect(npm.falsePositiveRate).toBeNull()
    // Raw counts are still surfaced (the data exists, it is just too thin to
    // turn into a rate) — but never a misleading 1.0.
    expect(npm.dispositioned).toBe(2)
    expect(npm.falsePositives).toBe(2)
    expect(npm.falsePositiveRate).not.toBe(1)

    const secret = byCategory(report, 'HARDCODED_SECRET')
    expect(secret.status).toBe('insufficient')
    expect(secret.falsePositiveRate).toBeNull()
    expect(secret.falsePositiveRate).not.toBe(0)
  })

  it('false-positive measurement performs no writes', async () => {
    // The harness's only data access is the repository read. Feed it real rows
    // through the spied prisma, run the full collect→compute path, and assert
    // not one write method on boundaryCrossing was touched (mirrors LUM-436 c2,
    // which proved the drift sweep ran no child process).
    findMany.mockResolvedValue([
      { category: 'TEST_TAMPERING', disposition: 'FALSE_POSITIVE' },
      { category: 'TEST_TAMPERING', disposition: 'CONFIRMED' },
    ])

    // Imported lazily so the prisma mock is installed before the repo binds it.
    const { boundaryCrossingRepository } =
      await import('@/lib/repositories/boundary-crossing.repository')
    const rows = await boundaryCrossingRepository.findDispositioned()
    const report = computeFalsePositiveRates(rows as DispositionedCrossing[], {
      minSamples: 1,
    })

    // Real work happened — the read ran and produced a non-empty report.
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(byCategory(report, 'TEST_TAMPERING').dispositioned).toBe(2)

    // And nothing was written.
    for (const [, fn] of Object.entries(writeMethods)) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('tracks system AUTO_LEGIT separately and keeps it out of the human FP rate (LUM-478)', () => {
    // The human FP rate must measure HUMAN-disposition noise only. A system
    // auto-resolution (AUTO_LEGIT) is tracked per category so an auto-release
    // volume is always visible, but it never enters the rate denominator — else
    // an auto-cleared crossing would silently masquerade as a "confirmed real"
    // and deflate the noise signal.
    const crossings: DispositionedCrossing[] = [
      ...rep('TEST_TAMPERING', 'FALSE_POSITIVE', 9),
      ...rep('TEST_TAMPERING', 'CONFIRMED', 3),
      ...rep('TEST_TAMPERING', 'AUTO_LEGIT', 20),
    ]

    const report = computeFalsePositiveRates(crossings, { minSamples: 10 })
    const tamper = byCategory(report, 'TEST_TAMPERING')

    // Rate is the SAME as without the auto-legit rows — 9 / (9 + 3) = 0.75.
    expect(tamper.dispositioned).toBe(12)
    expect(tamper.falsePositiveRate).toBeCloseTo(0.75, 10)
    // …and the auto-legit volume is surfaced, not folded into `confirmed`.
    expect(tamper.confirmed).toBe(3)
    expect(tamper.autoLegit).toBe(20)
  })

  it('exposes a documented default sample threshold', () => {
    expect(DEFAULT_MIN_SAMPLES).toBeGreaterThanOrEqual(1)
    expect(Number.isInteger(DEFAULT_MIN_SAMPLES)).toBe(true)
  })

  it('reports a category with zero dispositions as insufficient, not divide-by-zero', () => {
    // An empty input set must not produce NaN/Infinity anywhere.
    const report = computeFalsePositiveRates([], { minSamples: 5 })
    expect(report.categories).toEqual([])
  })
})

/** Expand a category/disposition pair into `n` rows. */
function rep(
  category: string,
  disposition: 'FALSE_POSITIVE' | 'CONFIRMED' | 'AUTO_LEGIT',
  n: number
): DispositionedCrossing[] {
  return Array.from({ length: n }, () => ({ category, disposition }))
}

/** Find one category's row in the report; fail loudly if absent. */
function byCategory(
  report: { categories: Array<{ category: string }> },
  category: string
) {
  const row = report.categories.find(c => c.category === category)
  if (!row) throw new Error(`category ${category} missing from report`)
  return row as {
    category: string
    dispositioned: number
    falsePositives: number
    confirmed: number
    autoLegit: number
    status: 'measured' | 'insufficient'
    falsePositiveRate: number | null
  }
}

test('LUM-751: AUTO_SUPPRESSED is counted separately and kept out of the human FP denominator', () => {
  const rows = [
    ...Array.from({ length: 10 }, () => ({
      category: 'PROJECT_RULE_VIOLATION',
      disposition: 'FALSE_POSITIVE' as const,
    })),
    ...Array.from({ length: 5 }, () => ({
      category: 'PROJECT_RULE_VIOLATION',
      disposition: 'AUTO_SUPPRESSED' as const,
    })),
  ]
  const report = computeFalsePositiveRates(rows, { minSamples: 10 })
  const r = report.categories[0]!
  expect(r.dispositioned).toBe(10)
  expect(r.autoSuppressed).toBe(5)
  expect(r.falsePositiveRate).toBe(1)
  expect(formatReport(report)).toContain('5 auto-suppressed')
})
