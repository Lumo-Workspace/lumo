/**
 * LUM-914 — the pure pieces of the pre-rule retention stock: the shared expiry
 * reason (the sweep's rule, now naming why), the crossing stock
 * classification, the dead-letter age bucket and the script's argument
 * parsing / report formatting.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/services/retention-stock-rules.test.ts.
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

import {
  classifyStockCrossing,
  deadLetterAgeBucket,
  isRetentionStockCategory,
} from '@/lib/services/retention-stock.service'
import {
  formatApplyResult,
  formatStockPlan,
  parseStockArgs,
} from '../../scripts/retention-stock/args'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T00:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

describe('classifyStockCrossing', () => {
  const rolloutAt = ago(20)
  const row = (dispositionedAt: Date | null) => ({
    id: 'c',
    taskId: 't',
    category: 'DESTRUCTIVE_DB_COMMAND',
    target: null,
    disposition: 'CONFIRMED',
    dispositionedAt,
  })

  it('stock crossing classification holds what the rule would hold', () => {
    const base = { retentionDays: 7, rolloutAt, now: NOW }
    expect(classifyStockCrossing({ ...base, row: row(null) })).toEqual({
      due: false,
      reason: 'no_disposition_time',
    })
    expect(classifyStockCrossing({ ...base, row: row(ago(10)) })).toEqual({
      due: false,
      reason: 'ruled_under_longer_window',
    })
    expect(
      classifyStockCrossing({ ...base, retentionDays: 90, row: row(ago(30)) })
    ).toEqual({ due: false, reason: 'within_window' })
    const due = classifyStockCrossing({ ...base, row: row(ago(30)) })
    expect(due).toEqual({
      due: true,
      reason: 'disposition:CONFIRMED',
      // The purge window never reaches the rollout instant.
      before: new Date(rolloutAt.getTime() - 1),
    })
    const longAgo = classifyStockCrossing({
      ...base,
      rolloutAt: ago(2),
      row: row(ago(30)),
    })
    expect(longAgo).toMatchObject({ due: true, before: ago(7) })
  })
})

describe('deadLetterAgeBucket', () => {
  it('buckets how long a dead letter has sat', () => {
    expect(deadLetterAgeBucket(ago(10), NOW)).toBe('<=30d')
    expect(deadLetterAgeBucket(ago(31), NOW)).toBe('31-90d')
    expect(deadLetterAgeBucket(ago(91), NOW)).toBe('>90d')
  })
})

describe('retention stock script arguments', () => {
  // LUM-1064: without a plugin only the core categories exist.
  it('without a plugin, all means the core categories only', () => {
    expect(isRetentionStockCategory('dead-letter')).toBe(true)
    expect(isRetentionStockCategory('crossing-raw')).toBe(true)
    expect(isRetentionStockCategory('scan-evidence')).toBe(false)
    expect(parseStockArgs(['all']).categories).toEqual([
      'crossing-raw',
      'dead-letter',
    ])
  })

  it('stock script refuses an apply without matching confirmations', () => {
    expect(() =>
      parseStockArgs(['all', '--apply', '--confirm-scope', 'all'])
    ).toThrow('one category')
    expect(() =>
      parseStockArgs([
        'dead-letter',
        '--apply',
        '--confirm-scope',
        'crossing-raw',
        '--confirm-host',
        'h',
      ])
    ).toThrow('--confirm-scope must repeat')
    expect(() =>
      parseStockArgs([
        'dead-letter',
        '--apply',
        '--confirm-scope',
        'dead-letter',
      ])
    ).toThrow('--confirm-host')
    expect(() =>
      parseStockArgs([
        'dead-letter',
        '--apply',
        '--confirm-scope',
        'dead-letter',
        '--confirm-host',
        'h',
      ])
    ).toThrow('--rollback-branch')
    expect(() => parseStockArgs(['hook-events'])).toThrow('Unknown category')
    expect(() => parseStockArgs(['dead-letter', '--limit', '0'])).toThrow(
      'positive integer'
    )
    expect(() =>
      parseStockArgs(['dead-letter', '--batch-size', '500'])
    ).toThrow('at most 200')
    expect(() => parseStockArgs(['dead-letter', '--force'])).toThrow(
      'Unknown flag'
    )
    expect(
      parseStockArgs([
        'dead-letter',
        '--apply',
        '--confirm-scope',
        'dead-letter',
        '--confirm-host',
        'db.example',
        '--rollback-branch',
        'pre-lum914-dead-letter-20261003',
        '--limit',
        '5',
        '--batch-size',
        '10',
      ])
    ).toEqual({
      categories: ['dead-letter'],
      apply: true,
      limit: 5,
      batchSize: 10,
      confirmScope: 'dead-letter',
      confirmHost: 'db.example',
      rollbackBranch: 'pre-lum914-dead-letter-20261003',
    })
  })

  it('stock report prints counts, slugs and dates only', () => {
    const lines = formatStockPlan(
      {
        category: 'scan-evidence',
        due: 2,
        byWorkspace: { ws_1: 2 },
        oldest: ago(40),
        newest: ago(12),
        byReason: { hard_cap: 1, pr_ended: 1 },
        held: {},
        findings: 5,
      },
      new Map([['ws_1', 'acme']])
    )
    expect(lines).toEqual([
      'scan-evidence: due=2 · workspaces=1 · range 2026-10-11..2026-11-08',
      '  by reason: hard_cap=1, pr_ended=1',
      '  held (left alone): -',
      '  by workspace: acme=2',
      '  findings in due scans: 5',
    ])
    expect(
      formatApplyResult({
        category: 'dead-letter',
        processed: 3,
        lastId: 'j9',
      })
    ).toBe('dead-letter: processed=3 lastId=j9')
  })
})
