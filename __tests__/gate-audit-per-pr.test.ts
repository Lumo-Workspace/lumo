import {
  buildPerPrGateAudit,
  type CheckAudit,
  type GateHookEventRow,
  type GateSignalRow,
  type PrRef,
} from '@/lib/services/gate-audit'

/** A self-reported Bash run, optionally tagged with the session it ran in. */
function bash(
  command: string,
  createdAt: string,
  sessionId: string | null,
  type = 'POST_TOOL_USE'
): GateHookEventRow {
  return {
    type,
    payload: { tool_name: 'Bash', tool_input: { command } },
    createdAt: new Date(createdAt),
    sessionId,
  }
}

/** An independent CI check row, carrying its resolved PR number and commit. */
function ci(
  checkName: string,
  outcome: 'success' | 'failure' | 'not_run',
  createdAt: string,
  prNumber: number | null,
  headSha: string | null = 'head753',
  detailsUrl: string | null = null
): GateSignalRow {
  return {
    outcome,
    checkName,
    detailsUrl,
    source: 'github_check',
    createdAt: new Date(createdAt),
    headSha,
    prNumber,
  }
}

const PR_753: PrRef = {
  number: 753,
  title: 'gate audit panel',
  state: 'merged',
  headBranch: 'lumo/LUM-614-gates-audit',
  headSha: 'head753',
}
const PR_754: PrRef = {
  number: 754,
  title: 'strip quotes',
  state: 'merged',
  headBranch: 'lumo/LUM-614-fix-quotes',
  headSha: 'head754',
}

function ciNames(audit: CheckAudit): Record<string, string> {
  return Object.fromEntries(audit.ci.map(c => [c.name, c.status]))
}

describe('buildPerPrGateAudit', () => {
  it('lists CI checks on the PR head commit by their own names', () => {
    const result = buildPerPrGateAudit({
      hookRows: [],
      gateSignals: [
        // An older commit's checks must not stand in for the current head.
        ci('Vercel', 'failure', '2026-06-28T09:00:00.000Z', 753, 'old753'),
        ci('lint-and-format', 'failure', '2026-06-28T10:00:00.000Z', 753),
        // Re-run on the same head → the latest result per name wins.
        ci('lint-and-format', 'success', '2026-06-28T10:05:00.000Z', 753),
        ci(
          'Vercel',
          'success',
          '2026-06-28T10:01:00.000Z',
          753,
          'head753',
          'https://vercel.com/deploy/1'
        ),
        // LUM-838: never started → did not run, never failed.
        ci('e2e', 'not_run', '2026-06-28T10:02:00.000Z', 753),
      ],
      pullRequests: [PR_753, PR_754],
      sessionBranchById: {},
    })

    const pr753 = result.prs.find(p => p.pr.number === 753)!.audit
    expect(pr753.headSha).toBe('head753')
    expect(pr753.ci.map(c => c.name)).toEqual([
      'e2e',
      'lint-and-format',
      'Vercel',
    ])
    expect(ciNames(pr753)).toEqual({
      e2e: 'did_not_run',
      'lint-and-format': 'passed',
      Vercel: 'passed',
    })
    expect(pr753.ci.find(c => c.name === 'Vercel')!.detailsUrl).toBe(
      'https://vercel.com/deploy/1'
    )

    // A PR whose head has no CI checks yields an empty list, not a green one.
    const pr754 = result.prs.find(p => p.pr.number === 754)!.audit
    expect(pr754.headSha).toBe('head754')
    expect(pr754.ci).toEqual([])

    // A legacy row (written with a gate key, before LUM-839) reads by its name.
    const legacy = buildPerPrGateAudit({
      hookRows: [],
      gateSignals: [
        {
          ...ci('lumo/ci test', 'failure', '2026-09-10T10:00:00.000Z', 753),
          source: 'lumo_sandbox',
          gateKey: 'test',
        } as GateSignalRow,
      ],
      pullRequests: [PR_753],
      sessionBranchById: {},
    })
    expect(ciNames(legacy.prs[0]!.audit)).toEqual({ 'lumo/ci test': 'failed' })
  })

  it('keeps agent self-reported checks in their own list', () => {
    const result = buildPerPrGateAudit({
      hookRows: [
        bash('npx tsc --noEmit', '2026-06-28T09:00:00.000Z', 's753'),
        bash(
          'npx jest __tests__/x.test.ts',
          '2026-06-28T09:05:00.000Z',
          's753',
          'POST_TOOL_USE_FAILURE'
        ),
        // Not a check command → not listed.
        bash('ls -la', '2026-06-28T09:06:00.000Z', 's753'),
      ],
      // CI's "tsc" failed on the same PR — it must not override the agent's
      // own pass, and the agent's pass must not turn CI green.
      gateSignals: [ci('tsc', 'failure', '2026-06-28T09:30:00.000Z', 753)],
      pullRequests: [PR_753, PR_754],
      sessionBranchById: { s753: PR_753.headBranch },
    })

    const pr753 = result.prs.find(p => p.pr.number === 753)!.audit
    expect(pr753.selfReported).toEqual([
      {
        command: 'npx jest __tests__/x.test.ts',
        status: 'failed',
        exitCode: 1,
        at: '2026-06-28T09:05:00.000Z',
      },
      {
        command: 'npx tsc --noEmit',
        status: 'passed',
        exitCode: 0,
        at: '2026-06-28T09:00:00.000Z',
      },
    ])
    expect(ciNames(pr753)).toEqual({ tsc: 'failed' })

    const pr754 = result.prs.find(p => p.pr.number === 754)!.audit
    expect(pr754.selfReported).toEqual([])
    expect(result.unlinked).toBeNull()
  })

  it('shows the latest run of a repeated agent command once', () => {
    const result = buildPerPrGateAudit({
      hookRows: [
        bash(
          'npm test',
          '2026-06-28T09:00:00.000Z',
          null,
          'POST_TOOL_USE_FAILURE'
        ),
        bash('npm test', '2026-06-28T09:10:00.000Z', null),
      ],
      gateSignals: [],
      pullRequests: [PR_753],
      sessionBranchById: {},
    })
    expect(result.prs[0]!.audit.selfReported).toEqual([
      {
        command: 'npm test',
        status: 'passed',
        exitCode: 0,
        at: '2026-06-28T09:10:00.000Z',
      },
    ])
  })

  it('puts unresolved signals in the unlinked bucket', () => {
    const result = buildPerPrGateAudit({
      hookRows: [bash('npm test', '2026-06-28T09:00:00.000Z', 'sX')],
      gateSignals: [
        ci('Vercel', 'success', '2026-06-28T10:00:00.000Z', null, 'shaX'),
      ],
      pullRequests: [PR_753, PR_754],
      sessionBranchById: { sX: 'some/other-branch' },
    })
    for (const { audit } of result.prs) {
      expect(audit.ci).toEqual([])
      expect(audit.selfReported).toEqual([])
    }
    expect(result.unlinked).not.toBeNull()
    expect(result.unlinked!.headSha).toBe('shaX')
    expect(ciNames(result.unlinked!)).toEqual({ Vercel: 'passed' })
    expect(result.unlinked!.selfReported.map(s => s.command)).toEqual([
      'npm test',
    ])
  })

  it('attributes an unresolved signal to the sole pr when the task has one', () => {
    const result = buildPerPrGateAudit({
      hookRows: [bash('npx tsc --noEmit', '2026-06-28T09:00:00.000Z', null)],
      gateSignals: [ci('build', 'success', '2026-06-28T10:00:00.000Z', null)],
      pullRequests: [PR_753],
      sessionBranchById: {},
    })
    expect(ciNames(result.prs[0]!.audit)).toEqual({ build: 'passed' })
    expect(result.prs[0]!.audit.selfReported).toHaveLength(1)
    expect(result.unlinked).toBeNull()
  })

  it('keeps a signal naming an unknown pr unlinked even with a sole pr', () => {
    const result = buildPerPrGateAudit({
      hookRows: [],
      gateSignals: [ci('build', 'success', '2026-06-28T10:00:00.000Z', 999)],
      pullRequests: [PR_753],
      sessionBranchById: {},
    })
    expect(result.prs[0]!.audit.ci).toEqual([])
    expect(ciNames(result.unlinked!)).toEqual({ build: 'passed' })
  })

  function mergedPr(number: number, mergedAt: string | null): PrRef {
    return {
      number,
      title: `pr ${number}`,
      state: mergedAt ? 'merged' : 'open',
      headBranch: `lumo/pr-${number}`,
      mergedAt,
    }
  }

  it('multi-PR unresolved self-reported signal attributes to the PR delivered next after its timestamp', () => {
    const prs = [
      mergedPr(766, '2026-07-01T05:25:50.000Z'),
      mergedPr(768, '2026-07-01T05:43:27.000Z'),
      mergedPr(770, '2026-07-01T06:12:36.000Z'),
    ]
    const result = buildPerPrGateAudit({
      gateSignals: [],
      hookRows: [
        bash('tsc --noEmit', '2026-07-01T05:00:00.000Z', 's1'),
        bash('npm test', '2026-07-01T05:30:00.000Z', 's1'),
        bash('npx tsc --noEmit', '2026-07-01T06:00:00.000Z', 's1'),
      ],
      pullRequests: prs,
      sessionBranchById: { s1: 'lumo/LUM-620-session' }, // matches no PR headBranch
    })

    const commands = (n: number) =>
      result.prs
        .find(p => p.pr.number === n)!
        .audit.selfReported.map(s => s.command)
    expect(commands(766)).toEqual(['tsc --noEmit'])
    expect(commands(768)).toEqual(['npm test'])
    expect(commands(770)).toEqual(['npx tsc --noEmit'])
    expect(result.unlinked).toBeNull()
  })

  it('unresolved self-reported signal with no later delivery stays unlinked', () => {
    const prs = [
      mergedPr(766, '2026-07-01T05:25:50.000Z'),
      mergedPr(768, '2026-07-01T05:43:27.000Z'),
    ]
    const result = buildPerPrGateAudit({
      gateSignals: [],
      hookRows: [bash('tsc --noEmit', '2026-07-01T09:00:00.000Z', 's1')],
      pullRequests: prs,
      sessionBranchById: { s1: 'lumo/LUM-620-session' },
    })
    for (const { audit } of result.prs) expect(audit.selfReported).toEqual([])
    expect(result.unlinked!.selfReported.map(s => s.command)).toEqual([
      'tsc --noEmit',
    ])
  })
})
