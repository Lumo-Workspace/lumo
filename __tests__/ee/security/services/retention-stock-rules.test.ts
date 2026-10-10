/**
 * LUM-1064: plugin half of __tests__/services/retention-stock-rules.test.ts (split)
 *
 * LUM-914 — the pure pieces of the pre-rule retention stock: the shared expiry
 * reason (the sweep's rule, now naming why), the crossing stock
 * classification, the dead-letter age bucket and the script's argument
 * parsing / report formatting.
 */
import { scanEvidenceExpiryReason } from '@/lib/security-scan/evidence-retention'
import { scanRetentionDueReason } from '@/lib/services/scan-evidence-retention.service'
import { isRetentionStockCategory } from '@/lib/services/retention-stock.service'
import { parseStockArgs } from '../../../../scripts/retention-stock/args'

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
})
