/**
 * LUM-914 — the pure pieces of the pre-rule retention stock: the shared expiry
 * reason (the sweep's rule, now naming why), the crossing stock
 * classification, the dead-letter age bucket and the script's argument
 * parsing / report formatting.
 */
import { scanEvidenceExpiryReason } from '@/lib/security-scan/evidence-retention'
import { scanRetentionDueReason } from '@/lib/services/scan-evidence-retention.service'
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

const scan = (finishedAt: Date) => ({
  status: 'FINDINGS',
  stages: { hunt: 'RAN' },
  startedAt: finishedAt,
  finishedAt,
})
const pr = (state: string, endedAt: Date | null) => ({
  state,
  mergedAt: state === 'merged' ? endedAt : null,
  closedAt: state === 'closed' ? endedAt : null,
  updatedAt: endedAt ?? NOW,
})

describe('scanEvidenceExpiryReason', () => {
  it('names why a scan is due: zero retention, hard cap, ended PR', () => {
    const base = { allScansFinal: true, now: NOW }
    expect(
      scanEvidenceExpiryReason({
        ...base,
        scan: scan(ago(1)),
        pullRequest: pr('open', null),
        retentionDays: 0,
      })
    ).toBe('zero_retention')
    expect(
      scanEvidenceExpiryReason({
        ...base,
        scan: scan(ago(31)),
        pullRequest: pr('open', null),
        retentionDays: 7,
      })
    ).toBe('hard_cap')
    expect(
      scanEvidenceExpiryReason({
        ...base,
        scan: scan(ago(10)),
        pullRequest: pr('merged', ago(8)),
        retentionDays: 7,
      })
    ).toBe('pr_ended')
    expect(
      scanEvidenceExpiryReason({
        ...base,
        scan: scan(ago(10)),
        pullRequest: pr('merged', ago(6)),
        retentionDays: 7,
      })
    ).toBeNull()
    // A hunt still pending somewhere on the PR holds the ended-PR path.
    expect(
      scanEvidenceExpiryReason({
        ...base,
        allScansFinal: false,
        scan: scan(ago(10)),
        pullRequest: pr('merged', ago(8)),
        retentionDays: 7,
      })
    ).toBeNull()
  })
})

describe('scanRetentionDueReason', () => {
  const candidate = (finishedAt: Date) => ({
    id: 's',
    workspaceId: 'w',
    pullRequestId: 'p',
    status: 'CLEAN' as const,
    stages: null,
    startedAt: finishedAt,
    finishedAt,
    suggestedAt: null,
    pullRequest: pr('open', null),
  })

  it('waits out the zero-retention grace before calling a scan due', () => {
    expect(
      scanRetentionDueReason(
        candidate(new Date(NOW.getTime() - 60_000)),
        0,
        true,
        NOW
      )
    ).toBeNull()
    expect(scanRetentionDueReason(candidate(ago(1)), 0, true, NOW)).toBe(
      'zero_retention'
    )
  })
})

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
  it('stock script defaults to a read-only dry run', () => {
    expect(isRetentionStockCategory('dead-letter')).toBe(true)
    expect(isRetentionStockCategory('hook-events')).toBe(false)
    expect(parseStockArgs(['all'])).toEqual({
      categories: ['scan-evidence', 'crossing-raw', 'dead-letter'],
      apply: false,
      batchSize: 20,
    })
    expect(
      parseStockArgs(['crossing-raw', '--crossing-rollout-at', '2026-10-06'])
        .crossingRolloutAt
    ).toEqual(new Date('2026-10-06'))
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
