/**
 * LUM-1308 — the pure rules behind the redesigned Lumo review record: which
 * check a finding sits under, each check row's state and default fold, and
 * the order PRs are listed in.
 */
import {
  buildCheckRows,
  checkProgress,
  findingCheck,
  isEmptyCheck,
  orderPrs,
  prAttention,
  prLevelPreMergeChecks,
  reviewVerdict,
  summarizesUncovered,
  uncoveredChecks,
} from '@/ee/security/components/TaskDetailTimeline/lumo-review-checks'
import { agentContextForReview } from '@/ee/security/components/TaskDetailTimeline/security-agent-context'
import type { PreMergeCheckView } from '@/shared/src/pre-merge-checks'
import type {
  SecurityScanView,
  TaskSecurityScans,
} from '@/ee/security/services/pr-security-scan.service'

type Finding = SecurityScanView['findings'][number]

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key-id',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'src/cfg.ts',
    line: 3,
    title: 'AWS access key ID',
    detail: '',
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
  } as Finding
}

function scan(over: Partial<SecurityScanView> = {}): SecurityScanView {
  return {
    id: 's1',
    status: 'CLEAN',
    headSha: 'abcdef1234567',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    stages: {
      secrets: 'RAN',
      external: 'RAN',
      supplyChain: 'SKIPPED',
      judge: 'RAN',
      rewardHack: 'RAN',
      hunt: 'RAN',
    },
    partial: false,
    complete: true,
    coverage: 'CHECKED',
    huntProgress: null,
    huntOverCap: null,
    judgeOverCap: null,
    judgePartial: null,
    prTooLarge: null,
    ownedUnfinished: false,
    externalLate: false,
    error: null,
    startedAt: '2026-10-24T00:00:00Z',
    finishedAt: null,
    codeScrubbed: false,
    fixed: 0,
    findings: [],
    ...over,
  } as SecurityScanView
}

function pr(
  number: number,
  latest: SecurityScanView | null
): TaskSecurityScans['prs'][number] {
  return {
    pr: {
      id: `pr${number}`,
      number,
      title: `PR ${number}`,
      url: `https://github.com/o/r/pull/${number}`,
      state: 'open',
    },
    latest,
  }
}

describe('findingCheck', () => {
  it.each([
    [
      { provenance: 'DETERMINISTIC', kind: 'SECRET', ruleId: 'secret:x' },
      'secrets',
    ],
    [
      {
        provenance: 'DETERMINISTIC',
        kind: 'VULNERABILITY',
        ruleId: 'llm-output-to-sink:sql',
      },
      'external',
    ],
    [
      { provenance: 'EXTERNAL_TOOL', kind: 'VULNERABILITY', ruleId: 'semgrep' },
      'external',
    ],
    [
      { provenance: 'EXTERNAL_TOOL', kind: 'SECRET', ruleId: 'gitleaks' },
      'external',
    ],
    [
      { provenance: 'EXTERNAL_TOOL', kind: 'DEPENDENCY', ruleId: 'GHSA-1' },
      'supplyChain',
    ],
    [
      { provenance: 'LLM_JUDGE', kind: 'VULNERABILITY', ruleId: 'vuln:sqli' },
      'judge',
    ],
    [
      { provenance: 'LLM_JUDGE', kind: 'CORRECTNESS', ruleId: 'bug:race' },
      'judge',
    ],
    [
      { provenance: 'LLM_JUDGE', kind: 'VULNERABILITY', ruleId: 'hunt:ssrf' },
      'hunt',
    ],
    [
      {
        provenance: 'LLM_JUDGE',
        kind: 'REWARD_HACK',
        ruleId: 'reward-hack/skip',
      },
      'rewardHack',
    ],
  ] as const)('%o → %s', (f, check) => {
    expect(findingCheck(f)).toBe(check)
  })
})

describe('buildCheckRows', () => {
  it('lists every recorded check in display order, findings under their check', () => {
    const rows = buildCheckRows(
      scan({
        status: 'FINDINGS',
        findings: [
          finding({ id: 's' }),
          finding({
            id: 'j',
            provenance: 'LLM_JUDGE',
            kind: 'CORRECTNESS',
            ruleId: 'bug:x',
            blocking: false,
          }),
        ],
      })
    )
    expect(rows.map(r => r.key)).toEqual([
      'secrets',
      'external',
      'supplyChain',
      'judge',
      'rewardHack',
      'hunt',
    ])
    expect(rows.find(r => r.key === 'secrets')!.open.map(f => f.id)).toEqual([
      's',
    ])
    expect(rows.find(r => r.key === 'judge')!.open.map(f => f.id)).toEqual([
      'j',
    ])
  })

  it('opens a check with an open finding or that did not cover the PR, and only those', () => {
    const rows = buildCheckRows(
      scan({
        stages: {
          secrets: 'RAN',
          external: 'FAILED',
          supplyChain: 'SKIPPED',
          judge: 'RAN',
          hunt: 'RAN',
        },
        findings: [finding()],
      })
    )
    const open = Object.fromEntries(rows.map(r => [r.key, r.defaultOpen]))
    expect(open).toEqual({
      secrets: true,
      external: true,
      supplyChain: false,
      judge: false,
      hunt: false,
    })
    expect(rows.find(r => r.key === 'external')!.tone).toBe('warn')
    expect(rows.find(r => r.key === 'supplyChain')!.tone).toBe('off')
  })

  it('keeps quiet findings apart and does not open the row for them', () => {
    const [secrets] = buildCheckRows(
      scan({
        findings: [
          finding({ id: 'ruled', disposition: 'FALSE_POSITIVE' }),
          finding({ id: 'main', persisting: true }),
        ],
      })
    )
    expect(secrets!.open).toEqual([])
    expect(secrets!.quiet.map(f => f.id)).toEqual(['ruled', 'main'])
    expect(secrets!.defaultOpen).toBe(false)
  })

  it('marks size-capped checks as over the cap and opens them', () => {
    const rows = buildCheckRows(
      scan({
        stages: { secrets: 'RAN', judge: 'SKIPPED', hunt: 'SKIPPED' },
        judgeOverCap: { diffChars: 300000, capChars: 150000 },
        huntOverCap: { sourceFiles: 40, capFiles: 25 },
      })
    )
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(byKey.judge).toMatchObject({
      overCap: true,
      tone: 'warn',
      defaultOpen: true,
    })
    expect(byKey.hunt).toMatchObject({
      overCap: true,
      tone: 'warn',
      defaultOpen: true,
    })
    expect(byKey.secrets).toMatchObject({ overCap: false, tone: 'ok' })
  })

  it('a PR too large to scan puts every check over the cap', () => {
    const rows = buildCheckRows(
      scan({
        stages: { secrets: 'SKIPPED', external: 'SKIPPED' },
        prTooLarge: { reason: 'FILE_LIMIT', changedFiles: 400, capFiles: 300 },
      } as Partial<SecurityScanView>)
    )
    expect(rows.every(r => r.overCap && r.tone === 'warn')).toBe(true)
  })

  it('leaves out a layer the scan never recorded, unless a finding names it', () => {
    const rows = buildCheckRows(
      scan({
        stages: { secrets: 'RAN' },
        findings: [
          finding({
            id: 'h',
            provenance: 'LLM_JUDGE',
            kind: 'VULNERABILITY',
            ruleId: 'hunt:ssrf',
          }),
        ],
      })
    )
    expect(rows.map(r => r.key)).toEqual(['secrets', 'hunt'])
    expect(rows[1]).toMatchObject({
      state: null,
      tone: 'off',
      defaultOpen: true,
    })
  })

  it('a scanner late by 30 minutes is a warning that opens its row, not "scanning"', () => {
    const rows = buildCheckRows(
      scan({
        stages: { secrets: 'RAN', external: 'PENDING' },
        externalLate: true,
      })
    )
    expect(rows.find(r => r.key === 'external')).toMatchObject({
      tone: 'warn',
      defaultOpen: true,
    })
  })

  it('a running layer reads as pending, not as a warning', () => {
    const [secrets] = buildCheckRows(scan({ stages: { secrets: 'PENDING' } }))
    expect(secrets).toMatchObject({ tone: 'pending', defaultOpen: false })
  })
})

describe('prAttention / orderPrs', () => {
  const blocking = scan({ status: 'FINDINGS', findings: [finding()] })
  const advisory = scan({
    status: 'FINDINGS',
    findings: [finding({ blocking: false, severity: 'LOW' })],
  })
  const unfinished = scan({ complete: false, coverage: 'UNFINISHED' })
  const clean = scan()

  it('ranks blocking, then open, then not fully checked, then clean', () => {
    expect(prAttention(pr(1, blocking))).toBe(0)
    expect(prAttention(pr(2, advisory))).toBe(1)
    expect(prAttention(pr(3, unfinished))).toBe(2)
    expect(prAttention(pr(4, null))).toBe(2)
    expect(prAttention(pr(5, clean))).toBe(3)
  })

  it('a clean scan with a pre-merge check that did not pass still needs a look', () => {
    const warned = scan({
      preMergeChecks: [
        {
          id: 'c1',
          name: 'Issue assessment',
          mode: 'warning',
          verdict: 'failed',
          explanation: 'One goal is unmet',
          resolution: null,
        },
      ],
    })
    expect(prAttention(pr(6, warned))).toBe(2)
  })

  it('lists PRs in attention order (stable) and folds the clean ones', () => {
    const { listed, clean: folded } = orderPrs([
      pr(10, clean),
      pr(11, unfinished),
      pr(12, blocking),
      pr(13, clean),
      pr(14, advisory),
      pr(15, blocking),
    ])
    expect(listed.map(p => p.pr.number)).toEqual([12, 15, 14, 11])
    expect(folded.map(p => p.pr.number)).toEqual([10, 13])
  })

  it('layers turned off in settings do not pull a PR up; a size cap does', () => {
    const turnedOff = scan({ complete: false, coverage: 'TURNED_OFF' })
    expect(prAttention(pr(8, turnedOff))).toBe(3)
    const overCap = scan({
      complete: false,
      coverage: 'UNFINISHED',
      judgeOverCap: { diffChars: 300000, capChars: 150000 },
    })
    expect(prAttention(pr(9, overCap))).toBe(2)
  })

  it('a ruled-on finding no longer pulls its PR up', () => {
    const ruled = scan({
      status: 'FINDINGS',
      findings: [finding({ disposition: 'ACCEPTED_RISK', blocking: false })],
    })
    expect(prAttention(pr(7, ruled))).toBe(3)
  })
})

function preMerge(over: Partial<PreMergeCheckView> = {}): PreMergeCheckView {
  return {
    id: 'issue_assessment',
    name: 'Issue assessment',
    mode: 'warning',
    verdict: 'inconclusive',
    explanation: 'Check the requirements marked Unclear',
    resolution: null,
    requirements: [],
    ...over,
  }
}

describe('issue assessment on the reward-hack row', () => {
  it('puts an unmet issue assessment on the reward-hack row and opens it', () => {
    const s = scan({ preMergeChecks: [preMerge()] })
    const row = buildCheckRows(s).find(r => r.key === 'rewardHack')!
    expect(row.assessment?.id).toBe('issue_assessment')
    expect(row.defaultOpen).toBe(true)
    // …and only there.
    expect(
      buildCheckRows(s)
        .filter(r => r.assessment != null)
        .map(r => r.key)
    ).toEqual(['rewardHack'])
    expect(prLevelPreMergeChecks(s)).toEqual([])
  })

  it("a passed assessment is not shown; the repo's own checks stay at PR level", () => {
    const own = preMerge({ id: 'no-todo', name: 'No TODOs', verdict: 'failed' })
    const s = scan({
      preMergeChecks: [preMerge({ verdict: 'passed' }), own],
    })
    expect(
      buildCheckRows(s).find(r => r.key === 'rewardHack')!.assessment
    ).toBeNull()
    expect(prLevelPreMergeChecks(s)).toEqual([own])
  })

  it('draws the row for an assessment even when the layer was never recorded', () => {
    const s = scan({
      stages: { secrets: 'RAN', judge: 'RAN' },
      preMergeChecks: [preMerge()],
    })
    expect(buildCheckRows(s).map(r => r.key)).toEqual([
      'secrets',
      'judge',
      'rewardHack',
    ])
  })
})

describe('uncovered summary, progress and empty checks', () => {
  it('summarizes uncovered checks only when nothing needs a decision', () => {
    const uncovered = scan({
      stages: { secrets: 'RAN', external: 'FAILED', judge: 'NOT_CONFIGURED' },
      complete: false,
      coverage: 'UNFINISHED',
    })
    const rows = buildCheckRows(uncovered)
    expect(uncoveredChecks(rows).map(r => r.key)).toEqual(['external', 'judge'])
    expect(summarizesUncovered(rows)).toBe(true)
    const withFinding = buildCheckRows({
      ...uncovered,
      findings: [finding()],
    })
    expect(summarizesUncovered(withFinding)).toBe(false)
    const withAssessment = buildCheckRows({
      ...uncovered,
      preMergeChecks: [preMerge()],
    })
    expect(summarizesUncovered(withAssessment)).toBe(false)
    expect(summarizesUncovered(buildCheckRows(scan()))).toBe(false)
  })

  it('counts running checks as not done', () => {
    const rows = buildCheckRows(
      scan({
        stages: { secrets: 'RAN', external: 'PENDING', judge: 'PENDING' },
      })
    )
    expect(checkProgress(rows)).toEqual({ done: 1, total: 3 })
  })

  it('an empty check is checked or not needed with nothing in it', () => {
    const rows = buildCheckRows(
      scan({
        stages: { secrets: 'RAN', supplyChain: 'SKIPPED', judge: 'FAILED' },
        findings: [finding({ disposition: 'FALSE_POSITIVE' })],
      })
    )
    const byKey = Object.fromEntries(rows.map(r => [r.key, isEmptyCheck(r)]))
    // secrets has a quiet (ruled) finding; judge failed.
    expect(byKey).toEqual({ secrets: false, supplyChain: true, judge: false })
  })
})

describe('reviewVerdict', () => {
  const data = (
    prs: TaskSecurityScans['prs'],
    over: Partial<TaskSecurityScans> = {}
  ): TaskSecurityScans => ({
    prs,
    blocking: { count: 0 },
    suggested: { count: 0 },
    scanningOff: false,
    ...over,
  })
  it('most urgent first', () => {
    const blocking = pr(1, scan({ findings: [finding()] }))
    const open = pr(2, scan({ findings: [finding({ blocking: false })] }))
    const running = pr(3, scan({ coverage: 'IN_PROGRESS', complete: false }))
    const unfinished = pr(4, scan({ coverage: 'UNFINISHED', complete: false }))
    const premerge = pr(5, scan({ preMergeChecks: [preMerge()] }))
    const clean = pr(6, scan())
    expect(reviewVerdict(data([clean, blocking, open]))).toEqual({
      kind: 'blocking',
      count: 1,
    })
    expect(reviewVerdict(data([clean, open]))).toEqual({
      kind: 'open',
      count: 1,
    })
    expect(reviewVerdict(data([unfinished, running])).kind).toBe('scanning')
    expect(reviewVerdict(data([premerge, unfinished])).kind).toBe(
      'notFullyChecked'
    )
    expect(reviewVerdict(data([premerge, clean]))).toEqual({
      kind: 'preMerge',
      count: 1,
    })
    expect(reviewVerdict(data([clean])).kind).toBe('clean')
  })
  it('a late scanner is not "scanning"; an unscanned PR is not clean', () => {
    const late = pr(
      1,
      scan({ coverage: 'IN_PROGRESS', complete: false, externalLate: true })
    )
    expect(reviewVerdict(data([late])).kind).toBe('notFullyChecked')
    expect(reviewVerdict(data([pr(1, null), pr(2, scan())])).kind).toBe(
      'notFullyChecked'
    )
    expect(reviewVerdict(data([pr(1, null)])).kind).toBe('notScanned')
  })
  it('checks turned off are the customer\'s choice, not "not fully checked"', () => {
    const off = pr(1, scan({ coverage: 'TURNED_OFF', complete: false }))
    expect(reviewVerdict(data([off])).kind).toBe('turnedOff')
    expect(
      reviewVerdict(data([pr(1, scan())], { scanningOff: true })).kind
    ).toBe('turnedOff')
  })
})

describe('agentContextForReview', () => {
  it('joins every open finding across PRs and skips quiet ones', () => {
    const text = agentContextForReview({
      prs: [
        pr(
          1,
          scan({
            findings: [
              finding({ id: 'a', title: 'Key in fixture' }),
              finding({
                id: 'b',
                title: 'Ruled',
                disposition: 'FALSE_POSITIVE',
              }),
            ],
          })
        ),
        pr(2, scan({ findings: [finding({ id: 'c', title: 'Raw query' })] })),
      ],
      blocking: { count: 2 },
      suggested: { count: 0 },
      scanningOff: false,
    })
    expect(text).toContain('Key in fixture')
    expect(text).toContain('Raw query')
    expect(text).not.toContain('Ruled')
    expect(text.split('\n---\n')).toHaveLength(2)
  })
  it('is empty when nothing needs a decision', () => {
    expect(
      agentContextForReview({
        prs: [pr(1, scan())],
        blocking: { count: 0 },
        suggested: { count: 0 },
        scanningOff: false,
      })
    ).toBe('')
  })
})

describe('a batched hunt that finished short', () => {
  it('is a warning that opens its row; still running is pending', () => {
    const short = buildCheckRows(
      scan({ huntProgress: { coveredFiles: 14, totalFiles: 22 } })
    ).find(r => r.key === 'hunt')!
    expect(short.tone).toBe('warn')
    expect(short.defaultOpen).toBe(true)
    expect(isEmptyCheck(short)).toBe(false)
    const running = buildCheckRows(
      scan({
        stages: { secrets: 'RAN', hunt: 'PENDING' },
        huntProgress: { coveredFiles: 14, totalFiles: 22 },
      })
    ).find(r => r.key === 'hunt')!
    expect(running.tone).toBe('pending')
  })
})
