/**
 * LUM-496 Task 3: `summarizeSecurityScans` / `shouldExpandRow` are the pure
 * rules behind the Record tab's security-scan summary line and per-PR
 * default expansion.
 */
import {
  summarizeSecurityScans,
  shouldExpandRow,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary'
import type { SecurityScanView } from '@/lib/services/pr-security-scan.service'

function finding(over: Partial<SecurityScanView['findings'][number]> = {}) {
  return {
    id: 'f1',
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key-id',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'src/cfg.ts',
    line: 3,
    title: 'AWS access key ID',
    detail: 'committed',
    evidence: '',
    fingerprint: 'fp',
    externalRef: null,
    disposition: null,
    dispositionNote: null,
    inherited: false,
    blocking: true,
    persisting: false,
    queueExit: null,
    ...over,
  } as SecurityScanView['findings'][number]
}

function scan(over: Partial<SecurityScanView> = {}): SecurityScanView {
  return {
    id: 's1',
    status: 'FINDINGS',
    headSha: 'abcdef1234567',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    complete: true,
    coverage: 'CHECKED',
    externalLate: false,
    error: null,
    startedAt: '2026-09-03T00:00:00Z',
    finishedAt: null,
    fixed: 0,
    findings: [],
    ...over,
  }
}

describe('summarizeSecurityScans', () => {
  it('counts PRs and undispositioned findings across the latest scans', () => {
    const summary = summarizeSecurityScans([
      { latest: scan({ findings: [finding({ id: 'a' })] }) },
      { latest: scan({ findings: [finding({ id: 'b', severity: 'LOW' })] }) },
      { latest: null },
    ])
    expect(summary).toMatchObject({ prs: 3, findings: 2, allLow: false })
  })

  it('ignores dispositioned findings', () => {
    const summary = summarizeSecurityScans([
      {
        latest: scan({
          findings: [finding({ disposition: 'FALSE_POSITIVE' })],
        }),
      },
    ])
    expect(summary.findings).toBe(0)
  })

  it('allLow is true only when there is ≥1 finding and every one is LOW', () => {
    const allLow = summarizeSecurityScans([
      { latest: scan({ findings: [finding({ severity: 'LOW' })] }) },
    ])
    expect(allLow.allLow).toBe(true)

    const mixed = summarizeSecurityScans([
      {
        latest: scan({
          findings: [
            finding({ id: 'a', severity: 'LOW' }),
            finding({ id: 'b', severity: 'HIGH' }),
          ],
        }),
      },
    ])
    expect(mixed.allLow).toBe(false)

    // No findings at all must never read as "all LOW" (LUM-566: never let a
    // clean/absent result masquerade as a reviewed-and-fine one).
    const none = summarizeSecurityScans([{ latest: scan({ findings: [] }) }])
    expect(none.allLow).toBe(false)
  })

  it('counts latest scans whose external stage FAILED', () => {
    const summary = summarizeSecurityScans([
      { latest: scan({ stages: { external: 'FAILED' } }) },
      { latest: scan({ stages: { external: 'RAN' } }) },
      { latest: scan({ stages: { external: 'FAILED' } }) },
      { latest: null },
    ])
    expect(summary.externalFailed).toBe(2)
  })

  it('returns zeros for an empty PR list', () => {
    expect(summarizeSecurityScans([])).toEqual({
      prs: 0,
      findings: 0,
      allLow: false,
      externalFailed: 0,
      incomplete: 0,
    })
  })

  // Review F1: without this count the line read "3 PRs · no findings" while
  // two of the three scans never finished.
  it('counts PRs whose latest scan is missing or did not complete', () => {
    const summary = summarizeSecurityScans([
      { latest: scan({ complete: true }) },
      { latest: scan({ complete: false }) },
      { latest: null },
    ])
    expect(summary.incomplete).toBe(2)
    expect(summary.findings).toBe(0)
  })
})

describe('shouldExpandRow', () => {
  it('is false when there is no latest scan', () => {
    expect(shouldExpandRow(null)).toBe(false)
  })

  it('is true when the scan has an undispositioned finding', () => {
    expect(shouldExpandRow(scan({ findings: [finding()] }))).toBe(true)
  })

  it('is false when every finding is dispositioned', () => {
    expect(
      shouldExpandRow(
        scan({ findings: [finding({ disposition: 'ACCEPTED_RISK' })] })
      )
    ).toBe(false)
  })

  it('is true when the external stage FAILED with an error', () => {
    expect(
      shouldExpandRow(
        scan({
          findings: [],
          stages: { external: 'FAILED' },
          error: 'external: semgrep exit 90',
        })
      )
    ).toBe(true)
  })

  it('is false when the external stage FAILED but there is no error message', () => {
    expect(
      shouldExpandRow(
        scan({ findings: [], stages: { external: 'FAILED' }, error: null })
      )
    ).toBe(false)
  })

  it('is false for a clean, complete scan', () => {
    expect(shouldExpandRow(scan({ findings: [] }))).toBe(false)
  })

  // Review F1: an incomplete scan's stage notes / not-configured hint /
  // partial notice are exactly why the summary cannot claim a clean result —
  // they open with the section instead of hiding behind a chevron.
  it('is true when the scan did not complete, even with nothing else to flag', () => {
    expect(
      shouldExpandRow(
        scan({
          findings: [],
          status: 'CLEAN',
          complete: false,
          stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
        })
      )
    ).toBe(true)
  })
})

describe('LUM-738 supplyChain surface — rollup ignores persisting rows', () => {
  it('a persisting (already-on-main) finding is neither counted nor a reason to expand', () => {
    const only = scan({
      findings: [finding({ id: 'old', kind: 'DEPENDENCY', persisting: true })],
    })
    expect(summarizeSecurityScans([{ latest: only }])).toMatchObject({
      findings: 0,
      allLow: false,
    })
    expect(shouldExpandRow(only)).toBe(false)
    const mixed = scan({
      findings: [
        finding({ id: 'old', kind: 'DEPENDENCY', persisting: true }),
        finding({
          id: 'new',
          kind: 'DEPENDENCY',
          severity: 'LOW',
          persisting: false,
        }),
      ],
    })
    expect(summarizeSecurityScans([{ latest: mixed }])).toMatchObject({
      findings: 1,
      allLow: true,
    })
    expect(shouldExpandRow(mixed)).toBe(true)
  })
})

describe('LUM-775 queue exit', () => {
  it('a row that left the queue (merged / closed PR) is neither counted nor expanded for', () => {
    const summary = summarizeSecurityScans([
      {
        latest: scan({
          findings: [
            finding({
              id: 'a',
              queueExit: 'RESOLVED_ON_MAIN',
              blocking: false,
            }),
            finding({
              id: 'b',
              queueExit: 'MERGED_UNREVIEWED',
              blocking: false,
              severity: 'LOW',
            }),
            finding({ id: 'c', queueExit: 'PR_CLOSED', blocking: false }),
          ],
        }),
      },
    ])
    expect(summary.findings).toBe(0)
    expect(summary.allLow).toBe(false)
    expect(
      shouldExpandRow(
        scan({ findings: [finding({ queueExit: 'MERGED_UNREVIEWED' })] })
      )
    ).toBe(false)
    // A row still in the queue on the same scan keeps the count honest.
    expect(
      summarizeSecurityScans([
        {
          latest: scan({
            findings: [
              finding({ id: 'a', queueExit: 'RESOLVED_ON_MAIN' }),
              finding({ id: 'b' }),
            ],
          }),
        },
      ]).findings
    ).toBe(1)
  })
})
