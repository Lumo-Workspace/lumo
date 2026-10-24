/**
 * LUM-1308 — the pure rules behind the redesigned Lumo review record: which
 * check a finding sits under, each check row's state and default fold, and
 * the order PRs are listed in.
 */
import {
  buildCheckRows,
  findingCheck,
  orderPrs,
  prAttention,
} from '@/ee/security/components/TaskDetailTimeline/lumo-review-checks'
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
