/**
 * @jest-environment node
 *
 * LUM-1256 — how a local finding is labelled from the server context and
 * the `--pr` comparison of local findings with the PR's latest server scan.
 * The policy predicate's parity with the server lives with the plugin tests
 * (__tests__/ee/security/lum1256-policy-parity.test.ts).
 */
import {
  comparePrFindings,
  describeLabel,
  labelFinding,
  type ServerPrFinding,
} from '../../cli/src/lib/scan-labels'
import type { ScanContext } from '../../cli/src/lib/scan-context'
import {
  formatLocalScan,
  localScanJson,
  type LocalFinding,
  type LocalScanResult,
} from '../../cli/src/lib/local-scan-report'

const ctx = (over: Partial<ScanContext> = {}): ScanContext => ({
  version: 1,
  repo: 'acme/app',
  baseline: null,
  rulings: [],
  learnings: [],
  learningsScope: 'auto',
  policy: { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] },
  pullRequest: { number: 12, headSha: 'abc' },
  ...over,
})

const finding = {
  scanner: 'SECRETS' as const,
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH' as const,
  filePath: 'src/config.ts',
  fingerprint: 'fp1',
}

const ruling = (
  pullRequest: number,
  disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK' = 'FALSE_POSITIVE'
) => ({
  fingerprint: 'fp1',
  ruleId: finding.ruleId,
  disposition,
  by: 'Alice',
  at: '2026-10-17T08:00:00.000Z',
  pullRequest,
})

describe('labelFinding', () => {
  it('new, and would block DONE under the default policy', () => {
    const l = labelFinding(finding, ctx())
    expect(l).toEqual({
      status: 'NEW',
      by: null,
      at: null,
      pullRequest: null,
      carriesOver: null,
      learningId: null,
      wouldBlockDone: true,
    })
    expect(describeLabel(l)).toBe('new · would block DONE')
  })

  it('does not block when the policy does not list the severity', () => {
    const l = labelFinding(
      finding,
      ctx({
        policy: {
          block: [{ provenance: 'DETERMINISTIC', severity: 'MEDIUM' }],
        },
      })
    )
    expect(l.wouldBlockDone).toBe(false)
    expect(describeLabel(l)).toBe('new')
  })

  it('ruled false positive on this branch’s PR: carries over, does not block', () => {
    const l = labelFinding(finding, ctx({ rulings: [ruling(12)] }))
    expect(l).toMatchObject({
      status: 'FALSE_POSITIVE',
      by: 'Alice',
      pullRequest: 12,
      carriesOver: true,
      wouldBlockDone: false,
    })
    expect(describeLabel(l)).toBe(
      'ruled false positive by Alice on #12, 2026-10-17 (this branch’s PR — carries over)'
    )
  })

  it('a ruling from another PR is shown but is not inherited, so it still blocks', () => {
    const l = labelFinding(
      finding,
      ctx({ rulings: [ruling(3, 'ACCEPTED_RISK')] })
    )
    expect(l).toMatchObject({
      status: 'ACCEPTED_RISK',
      carriesOver: false,
      wouldBlockDone: true,
    })
    expect(describeLabel(l)).toBe(
      'accepted risk by Alice on #3, 2026-10-17 (another PR — a new PR does not inherit it) · would block DONE'
    )
  })

  it('a ruling without an open PR does not carry over', () => {
    const l = labelFinding(
      finding,
      ctx({ rulings: [ruling(12)], pullRequest: null })
    )
    expect(l.carriesOver).toBe(false)
    expect(l.wouldBlockDone).toBe(true)
  })

  it('already on main: persisting, never blocks', () => {
    const l = labelFinding(
      finding,
      ctx({
        baseline: { sha: 's', at: 'a', partial: false, fingerprints: ['fp1'] },
      })
    )
    expect(l).toMatchObject({ status: 'ON_MAIN', wouldBlockDone: false })
    expect(describeLabel(l)).toBe('already on main')
  })

  it('a learning matches by fingerprint, or by rule under its path glob', () => {
    const byFp = labelFinding(
      finding,
      ctx({
        learnings: [
          {
            id: 'mem1',
            repo: 'acme/app',
            fingerprint: 'fp1',
            ruleId: 'x',
            pathGlob: null,
          },
        ],
      })
    )
    expect(byFp).toMatchObject({ status: 'LEARNING', learningId: 'mem1' })
    // Learnings steer the AI review only: the gate is unchanged.
    expect(describeLabel(byFp)).toBe(
      'suppressed by learning mem1 (AI review only) · would block DONE'
    )
    const learnings = [
      {
        id: 'mem2',
        repo: 'acme/app',
        fingerprint: 'other',
        ruleId: finding.ruleId,
        pathGlob: 'src/**',
      },
    ]
    expect(labelFinding(finding, ctx({ learnings })).status).toBe('LEARNING')
    expect(
      labelFinding({ ...finding, filePath: 'lib/a.ts' }, ctx({ learnings }))
        .status
    ).toBe('NEW')
    // A rule-wide learning with no glob does not cover every finding of the rule.
    expect(
      labelFinding(
        finding,
        ctx({ learnings: [{ ...learnings[0]!, pathGlob: null }] })
      ).status
    ).toBe('NEW')
  })

  it('a ruling wins over the baseline, which still keeps it from blocking', () => {
    const l = labelFinding(
      finding,
      ctx({
        rulings: [ruling(3)],
        baseline: { sha: 's', at: 'a', partial: false, fingerprints: ['fp1'] },
      })
    )
    expect(l).toMatchObject({ status: 'FALSE_POSITIVE', wouldBlockDone: false })
  })
})

/** A server finding as an older server sends it: no `fingerprint`. */
function withoutFingerprint(f: ServerPrFinding): ServerPrFinding {
  const { fingerprint: _omit, ...rest } = f
  void _omit
  return rest
}

describe('comparePrFindings', () => {
  const server = (over: Partial<ServerPrFinding>): ServerPrFinding => ({
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key-id',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'src/config.ts',
    line: 2,
    title: 'AWS access key ID',
    fingerprint: 'fp1',
    open: true,
    disposition: null,
    ...over,
  })
  const local = [
    {
      ruleId: finding.ruleId,
      filePath: 'src/config.ts',
      line: 2,
      fingerprint: 'fp1',
    },
  ]

  it('splits still-open from fixed-since-the-push and counts the server-only layers', () => {
    const c = comparePrFindings(
      [
        server({}),
        server({ fingerprint: 'fp-gone', line: 9 }),
        server({
          fingerprint: 'fp-ruled',
          open: false,
          disposition: 'FALSE_POSITIVE',
        }),
        server({
          kind: 'VULNERABILITY',
          provenance: 'LLM_JUDGE',
          ruleId: 'judge:sqli',
          fingerprint: 'j',
        }),
        server({
          kind: 'CORRECTNESS',
          provenance: 'LLM_JUDGE',
          ruleId: 'review:bug',
          open: false,
        }),
        server({
          kind: 'VULNERABILITY',
          provenance: 'LLM_JUDGE',
          ruleId: 'hunt:ssrf',
          fingerprint: 'h',
        }),
        server({
          kind: 'DEPENDENCY',
          provenance: 'EXTERNAL_TOOL',
          fingerprint: 'dep',
        }),
      ],
      local,
      ['SECRETS']
    )
    expect(c.stillOpen.map(f => f.fingerprint)).toEqual(['fp1'])
    expect(c.fixedLocally.map(f => f.fingerprint)).toEqual(['fp-gone'])
    expect(c.serverOnly).toEqual({ aiReview: 1, hunt: 1 })
  })

  it('matches on rule + path + line when an older server sends no fingerprint', () => {
    const c = comparePrFindings(
      [withoutFingerprint(server({})), withoutFingerprint(server({ line: 7 }))],
      local,
      ['SECRETS']
    )
    expect(c.stillOpen).toHaveLength(1)
    expect(c.fixedLocally.map(f => f.line)).toEqual([7])
  })
})

describe('report with server context', () => {
  const f: LocalFinding = {
    kind: 'SECRET',
    ruleId: finding.ruleId,
    title: 'AWS access key ID',
    severity: 'HIGH',
    filePath: 'src/config.ts',
    line: 2,
    evidence: 'const k = "AKIA…(len 20)"',
    fingerprint: 'fp1',
    detail: 'd',
    scanner: 'SECRETS',
  }
  const result = (
    server: LocalScanResult['server'],
    findings = [f]
  ): LocalScanResult => ({
    scanners: ['SECRETS'],
    scope: 'staged changes',
    filesScanned: 1,
    skipped: [],
    elapsedMs: 3,
    findings,
    ...(server ? { server } : {}),
  })

  it('labels each finding and keeps the parseable first line', () => {
    const labelled = {
      ...f,
      server: labelFinding(f, ctx({ rulings: [ruling(12)] })),
    }
    const out = formatLocalScan(
      result(
        {
          source: 'live',
          note: null,
          repo: 'acme/app',
          fetchedAt: 't',
          pullRequest: 12,
          policy: ctx().policy,
          pr: null,
        },
        [labelled]
      ),
      { width: 200 }
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('scan: 1 finding (1 high, 0 medium, 0 low)')
    expect(lines[2]).toBe(
      'Server: acme/app · live · PR #12 · 0 would block DONE'
    )
    expect(out).toMatch(
      /Server: +ruled false positive by Alice on #12, 2026-10-17 \(this branch’s PR — carries over\)/
    )
  })

  it('LUM-1330 a renamed repository: names both and how to update the remote', () => {
    const out = formatLocalScan(
      result({
        source: 'live',
        note: null,
        repo: 'acme/new',
        renamedFrom: 'acme/old',
        fetchedAt: 't',
        pullRequest: null,
        policy: ctx().policy,
        pr: null,
      }),
      { width: 200 }
    )
    expect(out).toContain('Server: acme/new · live · 0 would block DONE')
    expect(out).toContain(
      'Note: acme/old was renamed to acme/new. Update your git remote:'
    )
    expect(out).toContain(
      '  git remote set-url origin https://github.com/acme/new.git'
    )
  })

  it('LUM-1330 --json carries renamedFrom (null when there was no rename)', () => {
    const server = {
      source: 'live' as const,
      note: null,
      repo: 'acme/new',
      renamedFrom: 'acme/old',
      fetchedAt: 't',
      pullRequest: null,
      policy: ctx().policy,
      pr: null,
    }
    expect(localScanJson(result(server)).serverContext).toMatchObject({
      repo: 'acme/new',
      renamedFrom: 'acme/old',
    })
    expect(
      localScanJson(result({ ...server, renamedFrom: null })).serverContext
    ).toMatchObject({ renamedFrom: null })
  })

  it('says why there is no context', () => {
    const out = formatLocalScan(
      result({
        source: 'none',
        note: 'this Lumo server does not serve scan context (no security plugin, or an older server)',
        repo: 'acme/app',
        fetchedAt: null,
        pullRequest: null,
        policy: null,
        pr: null,
      })
    )
    expect(out.split('\n')[2]).toBe(
      'Server: no context — this Lumo server does not serve scan context (no security plugin, or an older server)'
    )
  })

  it('--json declares server, serverContext and wouldBlockDone', () => {
    const labelled = { ...f, server: labelFinding(f, ctx()) }
    const json = localScanJson(
      result(
        {
          source: 'cache',
          note: '--offline — using the context cached t',
          repo: 'acme/app',
          fetchedAt: 't',
          pullRequest: 12,
          policy: ctx().policy,
          pr: {
            number: 12,
            headSha: 'abc',
            note: null,
            comparison: {
              stillOpen: [],
              fixedLocally: [],
              serverOnly: { aiReview: 2, hunt: 0 },
            },
          },
        },
        [labelled]
      )
    )
    expect(
      (json.findings as Array<Record<string, unknown>>)[0]!.server
    ).toMatchObject({
      status: 'NEW',
      wouldBlockDone: true,
    })
    expect(json.wouldBlockDone).toBe(1)
    expect(json.serverContext).toMatchObject({
      source: 'cache',
      pullRequest: 12,
      pr: {
        number: 12,
        stillOpen: [],
        fixedLocally: [],
        serverOnly: { aiReview: 2, hunt: 0 },
      },
    })
    const none = localScanJson(result(undefined))
    expect(none.serverContext).toBeNull()
    expect(none.wouldBlockDone).toBeNull()
    expect(
      (none.findings as Array<Record<string, unknown>>)[0]!.server
    ).toBeNull()
  })
})
