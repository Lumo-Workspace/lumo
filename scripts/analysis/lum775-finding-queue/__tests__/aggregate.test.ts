/** @jest-environment node */
import {
  classifyQueue,
  QUEUE_BUCKETS,
  renderQueueReport,
  type QueueFindingRow,
} from '../aggregate'
import { DEFAULT_SECURITY_POLICY } from '@/ee/security/security-scan/policy'

const MERGED_AT = new Date('2026-09-10T10:00:00Z')
const fresh = {
  sha: 'main',
  at: '2026-09-10T11:00:00Z',
  requestedAt: '2026-09-10T10:30:00Z',
  fingerprints: ['fp-still-there'],
  partial: false,
  tools: ['gitleaks', 'semgrep', 'osv-scanner'],
}

function row(
  over: Partial<QueueFindingRow> & {
    pr?: Partial<QueueFindingRow['scan']['pullRequest']>
    scanId?: string
    prId?: string
  }
): QueueFindingRow {
  const { pr, scanId, prId, ...rest } = over
  return {
    id: 'f',
    kind: 'DEPENDENCY',
    ruleId: 'ext:osv-scanner:GHSA-1',
    severity: 'MEDIUM',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'package-lock.json',
    fingerprint: 'fp-gone',
    persisting: false,
    scan: {
      id: scanId ?? 'latest',
      pullRequestId: prId ?? 'pr-merged',
      workspaceId: 'ws',
      pullRequest: {
        number: 1,
        state: 'merged',
        repo: 'o/r',
        mergedAt: MERGED_AT,
        ...pr,
      },
    },
    ...rest,
  }
}

const inputs = {
  latestScanIdByPr: new Map([
    ['pr-merged', 'latest'],
    ['pr-open', 'latest-open'],
    ['pr-closed', 'latest-closed'],
  ]),
  baselines: new Map([['ws:o/r', fresh]]),
  policies: new Map(),
  defaultPolicy: DEFAULT_SECURITY_POLICY,
}

describe('classifyQueue', () => {
  it('puts every undispositioned row in exactly one bucket and explains the OPEN ones', () => {
    const rows: QueueFindingRow[] = [
      row({ id: 'superseded', scanId: 'old' }),
      row({ id: 'persisting', persisting: true }),
      row({ id: 'resolved' }),
      row({ id: 'onmain', fingerprint: 'fp-still-there' }),
      row({
        id: 'fixture',
        kind: 'SECRET',
        ruleId: 'secret:aws-access-key-id',
        provenance: 'DETERMINISTIC',
        severity: 'LOW',
        filePath: '__tests__/a.test.ts',
      }),
      row({
        id: 'high-merged',
        kind: 'SECRET',
        ruleId: 'secret:aws-access-key-id',
        provenance: 'DETERMINISTIC',
        severity: 'HIGH',
        filePath: 'lib/cfg.ts',
      }),
      row({
        id: 'open-pr',
        prId: 'pr-open',
        scanId: 'latest-open',
        pr: { number: 2, state: 'open', mergedAt: null },
      }),
      row({
        id: 'closed-pr',
        prId: 'pr-closed',
        scanId: 'latest-closed',
        pr: { number: 3, state: 'closed', mergedAt: null },
      }),
    ]
    const stats = classifyQueue({ ...inputs, rows })
    expect(stats.total).toBe(8)
    expect(stats.buckets).toEqual({
      SUPERSEDED_SCAN: 1,
      PERSISTING: 1,
      RESOLVED_ON_MAIN: 1,
      MERGED_UNREVIEWED: 2,
      PR_CLOSED: 1,
      OPEN: 2,
    })
    expect(Object.values(stats.buckets).reduce((a, b) => a + b, 0)).toBe(
      stats.total
    )
    expect(stats.byPrState).toEqual({ merged: 6, open: 1, closed: 1 })
    expect(stats.dedupAll).toBe(3)
    expect(stats.open.map(r => [r.id, r.blocking, r.why])).toEqual([
      [
        'high-merged',
        true,
        'blocking under policy; baseline cannot vouch (not an external-tool finding)',
      ],
      ['open-pr', false, 'PR open'],
    ])
    expect(stats.dedupOpen).toBe(2)
    expect(stats.openByKind).toEqual({ SECRET: 1, DEPENDENCY: 1 })
  })

  it('a repo without a baseline cannot resolve anything: advisories are MERGED_UNREVIEWED', () => {
    const stats = classifyQueue({
      ...inputs,
      baselines: new Map(),
      rows: [row({ id: 'a' })],
    })
    expect(stats.buckets.MERGED_UNREVIEWED).toBe(1)
    expect(stats.buckets.RESOLVED_ON_MAIN).toBe(0)
  })

  it('uses the workspace policy: an EXTERNAL_TOOL HIGH stays OPEN when the policy blocks it and the baseline still carries it', () => {
    const stats = classifyQueue({
      ...inputs,
      policies: new Map([
        ['ws', { block: [{ provenance: 'EXTERNAL_TOOL', severity: 'HIGH' }] }],
      ]),
      rows: [row({ id: 'a', severity: 'HIGH', fingerprint: 'fp-still-there' })],
    })
    expect(stats.buckets.OPEN).toBe(1)
    expect(stats.open[0]?.why).toBe(
      'blocking under policy; still in default-branch baseline'
    )
  })
})

describe('renderQueueReport', () => {
  it('prints every bucket, the task-start reference and one line per OPEN row', () => {
    const out = renderQueueReport(
      classifyQueue({
        ...inputs,
        rows: [
          row({ id: 'a' }),
          row({
            id: 'b',
            prId: 'pr-open',
            scanId: 'latest-open',
            pr: { number: 2, state: 'open', mergedAt: null },
          }),
        ],
      })
    )
    for (const b of QUEUE_BUCKETS) expect(out).toContain(b)
    expect(out).toContain('undispositioned rows: 2 (task start: 985)')
    expect(out).toContain('(task start: 182)')
    expect(out).toContain('OPEN — the current real queue: 1 rows')
    expect(out).toContain(
      '  - PR #2 (open) [MEDIUM] EXTERNAL_TOOL ext:osv-scanner:GHSA-1 — package-lock.json · advisory · PR open'
    )
  })
})
