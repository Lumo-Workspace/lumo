/**
 * LUM-496 Task 3: `summarizeSecurityScans` / `shouldExpandRow` are the pure
 * rules behind the Record tab's security-scan summary line and per-PR
 * default expansion.
 */
import {
  blockingFindings,
  summarizeSecurityScans,
  shouldExpandRow,
  isOverSizeLimitOnly,
  isQuietFinding,
  findingGroupKey,
  groupFindings,
  stageReason,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary'
import type {
  SecurityScanView,
  TaskSecurityScans,
} from '@/lib/services/pr-security-scan.service'

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
    huntProgress: null,
    huntOverCap: null,
    judgeOverCap: null,
    ownedUnfinished: false,
    externalLate: false,
    error: null,
    startedAt: '2026-09-03T00:00:00Z',
    finishedAt: null,
    codeScrubbed: false,
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
      overSizeLimit: 0,
      turnedOff: 0,
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

// LUM-832 — a scan that skipped a layer only because the change was over its
// size cap is not "not fully checked yet": nothing is coming later. It is
// counted on its own ("N scans over the size limit"), never as incomplete.
describe('LUM-832 over the size limit', () => {
  const overCap = {
    coverage: 'UNFINISHED' as const,
    ownedUnfinished: false,
    complete: false,
    huntOverCap: { sourceFiles: 151, capFiles: 150 },
    judgeOverCap: null,
  }

  it('isOverSizeLimitOnly: a size notice and no gap of ours', () => {
    expect(isOverSizeLimitOnly(scan(overCap))).toBe(true)
    expect(
      isOverSizeLimitOnly(
        scan({
          ...overCap,
          huntOverCap: null,
          judgeOverCap: { diffChars: 234_923, capChars: 180_000 },
        })
      )
    ).toBe(true)
    // A fault of ours on top of the cap is still unfinished, owned.
    expect(
      isOverSizeLimitOnly(scan({ ...overCap, ownedUnfinished: true }))
    ).toBe(false)
    // Unfinished for a reason of ours, with no size notice.
    expect(
      isOverSizeLimitOnly(
        scan({ ...overCap, huntOverCap: null, ownedUnfinished: true })
      )
    ).toBe(false)
    // A checked scan is not over anything.
    expect(isOverSizeLimitOnly(scan({ coverage: 'CHECKED' }))).toBe(false)
  })

  it('counts size-capped scans apart from the ones not fully checked yet', () => {
    const summary = summarizeSecurityScans([
      { latest: scan(overCap) },
      { latest: scan({ ...overCap, ownedUnfinished: true }) },
      { latest: scan({ complete: true, coverage: 'CHECKED' }) },
      { latest: null },
    ])
    expect(summary.overSizeLimit).toBe(1)
    // The owned-unfinished scan and the never-scanned PR — not the capped one.
    expect(summary.incomplete).toBe(2)
  })

  it('a size-capped scan still opens its row, so the notice is in view', () => {
    expect(shouldExpandRow(scan({ ...overCap, findings: [] }))).toBe(true)
  })
})

// LUM-1009: the Needs action list of security findings.
describe('blockingFindings', () => {
  const prScan = (
    number: number,
    findings: { id: string; blocking: boolean }[]
  ) =>
    ({
      pr: { id: `pr${number}`, number, title: 't', url: '#', state: 'open' },
      latest: { findings },
    }) as unknown as TaskSecurityScans['prs'][number]

  it('keeps only blocking findings, tagged with their PR number, in PR order', () => {
    expect(
      blockingFindings([
        prScan(7, [
          { id: 'a', blocking: true },
          { id: 'b', blocking: false },
        ]),
        prScan(9, [{ id: 'c', blocking: true }]),
      ]).map(x => [x.prNumber, x.finding.id])
    ).toEqual([
      [7, 'a'],
      [9, 'c'],
    ])
  })

  it('is empty without scans or blocking findings', () => {
    expect(blockingFindings([])).toEqual([])
    expect(
      blockingFindings([
        { ...prScan(7, []), latest: null } as TaskSecurityScans['prs'][number],
        prScan(8, [{ id: 'b', blocking: false }]),
      ])
    ).toEqual([])
  })
})

// LUM-1012: what the panel folds to one line and never counts as "N findings".
describe('isQuietFinding', () => {
  it('an undispositioned, in-queue, unverified finding is not quiet', () => {
    expect(isQuietFinding(finding() as never)).toBe(false)
  })
  it('ruled on, on main, out of the queue, or rejected by the verifier is quiet', () => {
    for (const over of [
      { disposition: 'FALSE_POSITIVE' },
      { persisting: true },
      { queueExit: 'MERGED' },
      { verifierVerdict: 'REJECTED' },
    ]) {
      expect(isQuietFinding(finding(over as never) as never)).toBe(true)
    }
  })
})

describe('LUM-1012 follow-up — findingGroupKey / groupFindings', () => {
  test('a ruling wins, then a verifier rejection, then the queue / main labels', () => {
    expect(findingGroupKey(finding())).toBe('open')
    expect(
      findingGroupKey(
        finding({
          disposition: 'FALSE_POSITIVE',
          verifierVerdict: 'REJECTED',
        } as Partial<SecurityScanView['findings'][number]>)
      )
    ).toBe('ruled')
    expect(
      findingGroupKey(
        finding({
          verifierVerdict: 'REJECTED',
          queueExit: 'MERGED_UNREVIEWED',
        } as Partial<SecurityScanView['findings'][number]>)
      )
    ).toBe('verifierRejected')
    expect(
      findingGroupKey(finding({ queueExit: 'PR_CLOSED', persisting: true }))
    ).toBe('queueExit')
    expect(findingGroupKey(finding({ persisting: true }))).toBe('persisting')
  })

  test('groups come in decide-first order, queue exits split by kind, input order kept', () => {
    const groups = groupFindings([
      finding({
        id: 'rej',
        verifierVerdict: 'REJECTED',
      } as Partial<SecurityScanView['findings'][number]>),
      finding({ id: 'merged', queueExit: 'MERGED_UNREVIEWED' }),
      finding({ id: 'open-1' }),
      finding({ id: 'closed', queueExit: 'PR_CLOSED' }),
      finding({ id: 'open-2' }),
    ])
    expect(
      groups.map(g => [g.key, g.queueExit, g.findings.map(f => f.id)])
    ).toEqual([
      ['open', null, ['open-1', 'open-2']],
      ['queueExit', 'MERGED_UNREVIEWED', ['merged']],
      ['queueExit', 'PR_CLOSED', ['closed']],
      ['verifierRejected', null, ['rej']],
    ])
  })

  test('no findings, no groups', () => {
    expect(groupFindings([])).toEqual([])
  })
})

describe('LUM-1012 follow-up — stageReason', () => {
  const base = scan({
    stages: {
      secrets: 'RAN',
      external: 'NOT_CONFIGURED',
      supplyChain: 'SKIPPED',
      judge: 'FAILED',
      hunt: 'SKIPPED',
    },
  })

  test('a layer that checked the change has no reason', () => {
    expect(stageReason('secrets', base)).toBeNull()
  })

  test('a layer the scan does not carry has no reason', () => {
    expect(stageReason('hunt', scan())).toBeNull()
  })

  test('each not-run state names its own cause', () => {
    expect(stageReason('external', base)?.id).toBe(
      'securityScan.stageReason.NOT_CONFIGURED'
    )
    expect(stageReason('supplyChain', base)?.id).toBe(
      'securityScan.stageReason.supplyChainSkipped'
    )
    expect(stageReason('judge', base)?.id).toBe(
      'securityScan.stageReason.judgeFailed'
    )
    expect(stageReason('hunt', base)?.id).toBe(
      'securityScan.stageReason.huntSkipped'
    )
    expect(
      stageReason('external', scan({ stages: { external: 'DISABLED' } }))?.id
    ).toBe('securityScan.stageReason.DISABLED')
    expect(
      stageReason('secrets', scan({ stages: { secrets: 'FAILED' } }))?.id
    ).toBe('securityScan.stageReason.FAILED')
  })

  test('a size cap wins over the state and carries its numbers', () => {
    expect(
      stageReason(
        'judge',
        scan({
          stages: { judge: 'SKIPPED' },
          judgeOverCap: { diffChars: 189054, capChars: 180000 },
        } as Partial<SecurityScanView>)
      )
    ).toEqual({
      id: 'securityScan.stageReason.judgeOverCap',
      values: { size: 189054, cap: 180000 },
    })
  })

  test('the hunt file cap carries its numbers', () => {
    expect(
      stageReason(
        'hunt',
        scan({
          stages: { hunt: 'SKIPPED' },
          huntOverCap: { sourceFiles: 400, capFiles: 300 },
        } as Partial<SecurityScanView>)
      )
    ).toEqual({
      id: 'securityScan.stageReason.huntOverCap',
      values: { files: 400, cap: 300 },
    })
  })

  test('a batched hunt that stopped part-way says why it stopped, not "still running"', () => {
    for (const [state, id] of [
      ['FAILED', 'FAILED'],
      ['SUPERSEDED', 'SUPERSEDED'],
      ['PARTIAL', 'PARTIAL'],
    ] as const) {
      expect(
        stageReason(
          'hunt',
          scan({
            stages: { hunt: state },
            huntProgress: { coveredFiles: 40, totalFiles: 120 },
          } as Partial<SecurityScanView>)
        )?.id
      ).toBe(`securityScan.stageReason.${id}`)
    }
  })

  test('a partial batched hunt says how far it got; a finished one says nothing', () => {
    expect(
      stageReason(
        'hunt',
        scan({
          stages: { hunt: 'PENDING' },
          huntProgress: { coveredFiles: 40, totalFiles: 120 },
        } as Partial<SecurityScanView>)
      )
    ).toEqual({
      id: 'securityScan.stageReason.huntInProgress',
      values: { covered: 40, total: 120 },
    })
    expect(
      stageReason(
        'hunt',
        scan({
          stages: { hunt: 'RAN' },
          huntProgress: { coveredFiles: 45, totalFiles: 45 },
        } as Partial<SecurityScanView>)
      )
    ).toBeNull()
  })
})
